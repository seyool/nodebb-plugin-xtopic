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
		if (ajaxify.data.template.compose && ajaxify.data.isMain && ajaxify.data.topic) {
			// seperate composer page
			var actionBar = $('.composer .action-bar');
			addQnADropdownHandler(actionBar);
		}
	});

	///	토픽도구 로딩이 완료되면 질문글지정, 해결됨 지정 핸들러를 등록
	$(window).on('action:topic.tools.load', addHandlers);
	///	선택한 글을 답변글로 지정하는 핸들러 등록
	$(window).on('action:post.tools.load', addPostHandlers);

	///	토픽과 답글 로딩이 끝난 후 답변완된 글은 완료 표시를 한다
	$(window).on('action:posts.loaded', markPostAsSolved);
	$(window).on('action:topic.loaded', markPostAsSolved);

	///	composer로딩된 후 composer actionBar에 드롭다운 리스트 항목에 대한 핸들러를 연결한다
	$(window).on('action:composer.loaded', function (ev, data) {
		// Return early if it is a reply and not a new topic
		if (data.hasOwnProperty('composerData') && !data.composerData.isMain) {
			return;
		}
		var actionBar = $('.composer[data-uuid="' + data.post_uuid + '"] .action-bar');
		addQnADropdownHandler(actionBar);
	});

	///	composer 생성에 필터훅 지정, submitOptions에 새로운 드롭다운리스트 항목 추가
	require(['hooks', 'translator'], function (hooks, translator) {
		hooks.on('filter:composer.create', async (hookData) => {
			const translated = await translator.translate('[[qanda:thread.tool.as_question]]');
			hookData.createData.submitOptions.push({
				action: 'ask-as-question',
				text: `<i class="fa fa-fw fa-${hookData.postData.isQuestion ? 'check-' : ''}circle-o"></i> ${translated}`
			});
			return hookData;
		});
	});

	///	도롭다운리스트 항목 클릭시 이벤트핸들러, 단순히 질문으로 등록할지 체크를 토글한다
	function addQnADropdownHandler(actionBar) {
		const item = actionBar.find(`[data-action="ask-as-question"]`);
		item.on('click', () => {
			item.find('.fa').toggleClass('fa-circle-o').toggleClass('fa-check-circle-o');
			// Don't close dropdown on toggle (for better UX)
			return false;
		});

		$(window).one('action:composer.submit', function (ev, data) {
			if (item.find('.fa').hasClass('fa-check-circle-o')) {
				data.composerData.isQuestion = true;
			}
		});
	}

	///	글수정 완료이벤트에서 편집된 글의 질문여부/해결여부를 확인하여 토글시킨다
	$(window).on('action:posts.edited', function (ev, data) {
		require(['api'], function (api) {
			api.get(`/plugins/qna/${data.topic.tid}`, {})
				.then((res) => {
					const toggled = (ajaxify.data.isQuestion || '0') !== res.isQuestion || (ajaxify.data.isSolved || '0') !== res.isSolved;
					if (toggled) {
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
