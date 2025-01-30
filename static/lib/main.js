'use strict';

$('document').ready(function () {
	function translate(text, cb) {
		require(['translator'], function (translator) {
			translator.translate(text, cb);
		});
	}
	function alertType(type, message) {
		require(['alerts'], function (alerts) {
			alerts[type](message);
		});
	}
	$(window).on('action:ajaxify.end', function () {
		///debugger;
		/// 
		if (ajaxify.data.template.compose && ajaxify.data.isMain && ajaxify.data.topic) {
			// seperate composer page
			alert("여기는 한번도 호출 안되는 듯, 여기 호출되면 디버거 붙여 봐야함");
			debugger;
			var actionBar = $('.composer .action-bar');
			addQnADropdownHandler(actionBar);
		}
	});

	///	토픽도구 로딩이 완료되면 질문글지정, 해결됨 지정 핸들러를 등록, 토픽도구 클릭시 호출됨
	$(window).on('action:topic.tools.load', addHandlers);
	///	선택한 글을 답변글로 지정하는 핸들러 등록, 글도구를 클릭시 호출됨
	$(window).on('action:post.tools.load', addPostHandlers);

	///	토픽과 답글 로딩이 끝난 후 답변완료된 글은 완료 표시를 한다
	$(window).on('action:posts.loaded', markPostAsSolved);
	$(window).on('action:topic.loaded', markPostAsSolved);

	///	composer로딩된 후 composer actionBar에 드롭다운 리스트 항목에 대한 핸들러를 연결한다
	$(window).on('action:composer.loaded', function (ev, data) {
		/// 신규 토픽생성이 아니거나 응답글일 경우 조기 리턴시킴
		// Return early if it is a reply and not a new topic
		//if (data.hasOwnProperty('composerData') && !data.composerData.isMain) {
		//	return;
		//}

		/// data-uuid는 컴포저 전체이고, 그중에서 action-bar를 찾는데 actionbar는 숨기기/취소/제출 버튼들이다
		var actionBar = $('.composer[data-uuid="' + data.post_uuid + '"] .action-bar');
		addQnADropdownHandler(actionBar);
	});

	///	composer 생성에 필터훅 지정, submitOptions에 새로운 드롭다운리스트 항목 추가
	require(['hooks', 'translator', 'api'], function (hooks, translator, api) {
		hooks.on('filter:composer.create', async (hookData) => {
			const ctpId = {cid: hookData.postData.cid, tid: hookData.postData.tid, pid: hookData.postData.pid};
			const answer = await canPostHere(api, ctpId);
			
			if (answer.canPostQuestion) {
				/// composer 생성시에 무언가 처리하기, 여기서 서버측에서 보낸 anonPostEnabled값이 있으면 버튼을 추가
				/// 참고: https://community.nodebb.org/topic/16024/composer-tpl-add-custom-data/4
				let translated = await translator.translate('[[qanda:thread.tool.as_question]]');
				hookData.createData.submitOptions.push({
					action: 'ask-as-question',
					text: `<i class="quespost fa fa-fw fa-${hookData.postData.isQuestion ? 'check-' : ''}circle-o"></i> ${translated}`
				});
			}
			
			/// 작성자비노출글로 등록할 수 있는 버튼 추가
			/// fa인데 anonpost 로 대체함. 밑 addQnADropdownHandler()의 핸들러에서 토글할 수 있음
			if (answer.canPostAnonymous) {
				//debugger;
				translated = await translator.translate('[[qanda:thread.tool.as_anonymous]]');
				hookData.createData.submitOptions.push({
					action: 'post-as-anonymous',
					text: `<i class="anonpost fa fa-fw fa-${hookData.postData.isAnonymous ? 'check-' : ''}circle-o"></i> ${translated}`
				});	
			}

			return hookData;
		});
	});

	/// filter:composer.create시 전달되는 hookData.postData은 단계별로 변수명이 다르게 전달됨
	/// 토픽생성단계=cid, 답글작성단계=tid, 수정단계=pid
	/// require(x, (x) => { require(y, (y) = {})} require중첩 구조에서 api를 얻을 수 없었음
	/// 그래서 인자로 받아서 처리함
	//async function canPostAnonymous(api, cid, tid, pid) {
	async function canPostHere(api, ctpId) {
		let res = {canPostQuestion:false, canPostAnonymous: false};
	
		try {
			//const res = await api.get(`/plugins/anonpost`, { cid, tid, pid });
			res = await api.get(`/plugins/canpost`, ctpId);
		} catch (error) {
			console.error("Error in canPostAnonymous:", error);
		}
	
		return res;
	}

	///	도롭다운리스트 항목 클릭시 이벤트핸들러, 단순히 질문으로 등록할지 체크를 토글한다
	function addQnADropdownHandler(actionBar) {
		const item = actionBar.find(`[data-action="ask-as-question"]`);
		item.on('click', () => {
			item.find('.quespost').toggleClass('fa-circle-o').toggleClass('fa-check-circle-o');
			// Don't close dropdown on toggle (for better UX)
			return false;
		});

		///	드롭다운되었을때 익명글체크를 활성화한다
		const item2 = actionBar.find(`[data-action="post-as-anonymous"]`);
		item2.on('click', () => {
			item2.find('.anonpost').toggleClass('fa-circle-o').toggleClass('fa-check-circle-o');
			return false;
		});

		///	submit버튼이 눌러지면 composerData에 사용자가 체크한 옵션을 설정한다
		$(window).one('action:composer.submit', function (ev, data) {
			if (item.find('.quespost').hasClass('fa-check-circle-o')) {
				data.composerData.isQuestion = true;
			}
			if (item2.find('.anonpost').hasClass('fa-check-circle-o')) {
				data.composerData.isAnonymous = true;
			}			
		});
	}

	///	글수정 완료이벤트에서 편집된 글의 질문여부/해결여부를 확인하여 토글시킨다
	///	server library.js의 staticApiRoutes()에서 여기 요청을 처리함
	$(window).on('action:posts.edited', function (ev, data) {
		require(['api'], function (api) {
			api.get(`/plugins/qna/${data.topic.tid}`, {})
				.then((res) => {
					/// 토픽 여부를 결정해 리프레쉬한다
					const toggled = (ajaxify.data.isQuestion || '0') !== res.isQuestion 
								 || (ajaxify.data.isSolved || '0') !== res.isSolved
								 || (ajaxify.data.isAnonymous || '0') !== res.isAnonymous;
					if (toggled) {
						/// ajaxify는 페이지를 새로고침하지 않고도 새로운 콘텐츠를 로드하거나 데이터를 
						/// 가져올 수 있게 해주는 핵심 기능을 제공한다고 한다
						ajaxify.refresh();
					}
				});
		});
	});

	function addHandlers() {
		///	토픽도구 매뉴중 질문으로 설정, 해결됨으로 설정에 대한 핸들러
		$('.toggleQuestionStatus').on('click', toggleQuestionStatus);
		$('.toggleSolved').on('click', toggleSolved);
	}

	function addPostHandlers() {
		///	토픽에 대한 답변글중 선택한 글을 답변글로 설정
		$('[component="qanda/post-solved"]').on('click', markPostAsAnswer);
	}

	function toggleQuestionStatus() {
		///	선택된 토픽을 질문으로 db내 설정
		var tid = ajaxify.data.tid;
		callToggleQuestion(tid, true);
	}

	function callToggleQuestion(tid, refresh) {
		///	선택된 토픽을 질문으로 db내 설정
		socket.emit('plugins.QandA.toggleQuestionStatus', { tid: tid }, function (err, data) {
			if (err) {
				return alertType('error', err);
			}

			alertType('success', data.isQuestion ? '[[qanda:thread.alert.as_question]]' : '[[qanda:thread.alert.make_normal]]');
			if (refresh) {
				ajaxify.refresh();
			}
		});
	}

	function toggleSolved() {
		///	선택된 토픽을 db내 해결됨으로 설정
		var tid = ajaxify.data.tid;
		socket.emit('plugins.QandA.toggleSolved', { tid: tid }, function (err, data) {
			if (err) {
				return alertType('error', err);
			}

			alertType('success', data.isSolved ? '[[qanda:thread.alert.solved]]' : '[[qanda:thread.alert.unsolved]]');
			ajaxify.refresh();
		});
	}

	function markPostAsAnswer() {
		///	선택된 글을 해당 토픽에 대한 답변으로지정
		var tid = ajaxify.data.tid;
		var pid = $(this).parents('[data-pid]').attr('data-pid');

		socket.emit('plugins.QandA.markPostAsAnswer', { tid: tid, pid: pid }, function (err, data) {
			if (err) {
				return alertType('error', err);
			}

			alertType('success', data.isSolved ? '[[qanda:post.alert.correct_answer]]' : '[[qanda:thread.alert.unsolved]]');
			ajaxify.refresh();
		});
	}

	function markPostAsSolved() {
		///	해결된 답변으로 표시한다.
		if (!ajaxify.data.solvedPid) {
			return;
		}
		$('[component="topic"]').addClass('solved');
		const solvedEl = $('[component="post"][data-pid="' + ajaxify.data.solvedPid + '"]').first();
		if (solvedEl.length) {
			const prev = solvedEl.prevAll('[component="post"][data-index="0"]');
			if (!prev.length) {
				return;
			}

			solvedEl.addClass('isSolved');
			$(`[data-necro-post-index="${solvedEl.attr('data-index')}"]`).addClass('hidden');
			translate('[[qanda:label.solution]]', (translated) => {
				solvedEl.attr('data-label', translated);
			});
		}
	}
});
