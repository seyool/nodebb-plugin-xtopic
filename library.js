'use strict';

const validator = require.main.require('validator');

const topics = require.main.require('./src/topics');
const posts = require.main.require('./src/posts');
const categories = require.main.require('./src/categories');
const meta = require.main.require('./src/meta');
const privileges = require.main.require('./src/privileges');
const rewards = require.main.require('./src/rewards');
const user = require.main.require('./src/user');
const helpers = require.main.require('./src/controllers/helpers');
const db = require.main.require('./src/database');
const plugins = require.main.require('./src/plugins');
const SocketPlugins = require.main.require('./src/socket.io/plugins');
const pagination = require.main.require('./src/pagination');
const social = require.main.require('./src/social');

const plugin = module.exports;

plugin.init = async function (params) {
	///	admin페이지에 대한 라우트핸들러를 등록, 해결됨/미해결 지정 요청에 대한 라우트 핸들러 등록
	const { router } = params;
	const routeHelpers = require.main.require('./src/routes/helpers');

	routeHelpers.setupAdminPageRoute(router, '/admin/plugins/xtopic', renderAdmin);
	routeHelpers.setupPageRoute(router, '/unsolved', [], renderUnsolved);
	routeHelpers.setupPageRoute(router, '/solved', [], renderSolved);

	handleSocketIO();

	plugin._settings = await meta.settings.get('xtopic');
};

plugin.appendConfig = async function (config) {
	/// doBuildHeader -> apiController.loadConfig -> filter:config.get, 플러긴정보를 전역정보 config에 보관한다
	config['xtopic'] = plugin._settings;
	return config;
};

plugin.addNavigation = async function (menu) {
	///TODO: 언제 호출되나?  filter:navigation.available 필터훅
	menu = menu.concat(
		[
			{
				route: '/unsolved',
				title: '[[qanda:menu.unsolved]]',
				iconClass: 'fa-question-circle',
				textClass: 'visible-xs-inline',
				text: '[[qanda:menu.unsolved]]',
			},
			{
				route: '/solved',
				title: '[[qanda:menu.solved]]',
				iconClass: 'fa-check-circle',
				textClass: 'visible-xs-inline',
				text: '[[qanda:menu.solved]]',
			},
		]
	);
	return menu;
};

plugin.addAdminNavigation = async function (header) {
	/// filter:admin.header.build 필터훅, 관리자 페이지로 진입하려고 해당 매뉴를 클릭했을 때 호출됨
	header.plugins.push({
		route: '/plugins/xtopic',
		icon: 'fa-question-circle',
		name: 'X-Topic',
	});
	return header;
};

plugin.addAnswerDataToTopic = async function (hookData) {
	/// getTopic -> filter:topic.build
	/// 토픽에 대한 템플릿 렌더링 정보가 완성되었을 때, 해당 토픽의 해결/미해결 여부에 따라 그에 맞는 icon html을 추가한다, 
	// 템플릿렌더링 정보에 질문글/추천글/채택글 정보와 사용자 정보에 대한 렌더링 정보를 추가함

	///----------------------------------------
	let needRemoveAuthor = false;
	hookData.templateData.posts.forEach((post) => {
		if (post && post.isAnonymous) {
			post.user = usernameCensor(post.uid, {...post.user});
			post.uid = 0;
			needRemoveAuthor = true;
		}
	});

	if (needRemoveAuthor) {
		hookData.templateData.author = usernameCensor(hookData.templateData.uid, hookData.templateData.author);
		hookData.templateData.author.uid = 0;
	}

	/// 지금 보고 있는 카테고리(cid)에 사용자(uid)가 토픽/글 작성할 수 있으면 canPostAnonymous

	///-----------------------------------------


	if (!parseInt(hookData.templateData.isQuestion, 10)) {
		return hookData;
	}

	hookData.templateData.icons.push(getIconMarkup(hookData.templateData.isSolved));
	return await addMetaData(hookData);
};

plugin.filterTopicGetPosts = async (hookData) => {
	/// filter:topic.getPosts에 대한 훅함수, 토픽에 포함된 Posts를 구할때 호출, getTopic -> Topics.getTopicWithPosts -> Topics.getTopicPosts -> filter:topic.getPosts
	/// 페이지 요청시 호출됨, 정확히는 토픽에 포함된 글들을 구해졌을때 호출됨, 현재 토픽에 대한 해결글이 없으면 리턴

	/// 토픽내 답글들 중 채택글의 pid와 post.pid가 같으면 isAnswer값을 설정한다
	hookData.posts.forEach((post) => {
		///----------------------------------------
		if (post && post.isAnonymous) {
			post.user = usernameCensor(post.uid, {...post.user});
			post.uid = 0;
		}
	});
	
	const solvedPid = parseInt(hookData.topic.solvedPid, 10);
	if (!solvedPid) {
		return hookData;
	}

	/// showBestAnser가 왜 토픽내 첫번째 글의 index가 0인 것을 검사하는 지 모르겠다
	const showBestAnswer = hookData.posts.length && hookData.posts[0].index === 0;
	if (!showBestAnswer) {
		hookData.posts.forEach((p) =>{
			if (p && p.pid === solvedPid) {
				p.allowDupe = true;
			}
		});
		return hookData;
	}

	/// 첫번째 답글이 채택글이 아니면 answerIsNotFirstReply에 true를 지정, 
	const topicPosts = hookData.posts;
	const answerIsNotFirstReply = topicPosts.length > 1 && topicPosts[1].pid !== solvedPid;
	const found = topicPosts.find(p => p.pid === solvedPid);
	/// 첫번째 답글이 채택글이 아니고 채택된 글을 find한 결과가 있다면 1번째 요소에 solvedPost를 아래와 같이 값을 추가하고 삽입한다
	/// 왜 이런짓을 하나 봤더니, 토픽 바로 아래 채택글을 두려고 한 것 이다.
	if (found && answerIsNotFirstReply) {
		const copy = { ...found };
		copy.allowDupe = true;
		copy.navigatorIgnore = true;
		copy.eventStart = 0;
		copy.eventEnd = 0
		topicPosts.splice(1, 0, copy);
	} else if (answerIsNotFirstReply) {
		/// TODO: getPostsByPids 함수동작 방식 이해,  채태글이 없고, 1번째 글이 채택글이 아닌 경우
		/// 
		const answers = await posts.getPostsByPids([solvedPid], hookData.uid);
		const [postsData, postSharing] = await Promise.all([
			topics.addPostData(answers, hookData.uid),
			social.getActivePostSharing(),
		]);
		///
		let post = postsData[0];
		if (post) {
			const bestAnswerTopicData = { ...hookData.topic };
			bestAnswerTopicData.posts = postsData;
			bestAnswerTopicData.postSharing = postSharing;

			const topicPrivileges = await privileges.topics.get(hookData.topic.tid, hookData.uid);
			await topics.modifyPostsByPrivilege(bestAnswerTopicData, topicPrivileges);

			post = bestAnswerTopicData.posts[0];
			post.allowDupe = true;
			post.navigatorIgnore = true;
			const indices = await posts.getPostIndices([post], hookData.uid);
			post.index = indices[0];
			topicPosts.splice(1, 0, post);
		}
	}

	/// 토픽내 답글들 중 채택글의 pid와 post.pid가 같으면 isAnswer값을 설정한다
	hookData.posts.forEach((post) => {
		if (post) {
			post.isAnswer = post.pid === solvedPid;
		}	
	});

	return hookData;
};

async function addMetaData(data) {
	/// 토픽에 대한 템플릿 렌더링 정보가 완성되었을 때 호출됨, 템플릿렌더링 정보에 메인글, 추천글, 채택글 정보와 추가적인 메타정보(사용자명, 추천정보, 북마크 등)을 추가해준다
	/// 전달된 토픽의 mainPid와 추천글 목록에서 Pids를 구하고 2개 값을 pidsToFetch로 합친다
	const { tid } = data.templateData;
	const { uid } = data.req;
	const pidsToFetch = [data.templateData.mainPid, await posts.getPidsFromSet(`tid:${tid}:posts:votes`, 0, 0, true)];
	let mainPost;
	let suggestedAnswer;
	let acceptedAnswer;

	/// solvedPid가 있으면 pidsToFetch에 추가함
	if (data.templateData.solvedPid) {
		pidsToFetch.push(data.templateData.solvedPid);
	}

	/// ainPost, 제안답변, 수락한답변을 구함(pidsToFetch는 mainPid, 가장많은 추천을 받은 pid, solvedPid)
	const postsData = [mainPost, suggestedAnswer, acceptedAnswer] = await posts.getPostsByPids(pidsToFetch, uid);
	await topics.addPostData(postsData, uid);

	/// 각 글들의 content html 을 escape되지 않도로 처리
	postsData.forEach((p) => {
		p.content = String(p.content || '')
			.replace(/\\/g, '\\\\')
			.replace(/\n/g, '\\n')
			.replace(/"/g, '\\"')
			.replace(/\t/g, '\\t');
	});

	/// templateData에 mainPost/suggestedAnswer, answerScount, mainPost Title 을 추가한다
	data.templateData.mainPost = mainPost || {};
	data.templateData.acceptedAnswer = acceptedAnswer || {};
	if (suggestedAnswer && suggestedAnswer.pid !== data.templateData.mainPid) {
		data.templateData.suggestedAnswer = suggestedAnswer || {};
	}
	/// data.res.locals.postHeader에 templateData를 참고하여 topic jsonld html을 렌더링한 결과를 저장한다
	data.templateData.answerCount = Math.max(0, data.templateData.postcount - 1);
	data.templateData.mainPost.title = validator.escape(String(data.templateData.titleRaw));
	data.res.locals.postHeader = await data.req.app.renderAsync('partials/xtopic/topic-jsonld', data.templateData);
	return data;
}

plugin.getTopics = async function (hookData) {
	/// filter:topics.get 은 카테고리 목록 화면을 접근할 때 호출됨
	/// filter:topics.get 훅함수, 보고있는 카테고리의 토픽들을 구해졌을 때 호출, getTopicsFromSet -> Topics.getTopics -> filter:topics.get
	///	보고 있는 카테고리에 대한 토픽을 구해졌을 때, hookData.topics의 각 토픽내 isQuestion이 존재하면 isSolved값에 따라 topic.icons에 해결됨/미해결중 아이콘을 추가함
	///	즉 토픽목록정보에 해당 토픽이 해결됨/미해결 표시를 위한 html 태그를 추가해서 리턴함
	hookData.topics.forEach((topic) => {
		if (topic && parseInt(topic.isQuestion, 10)) {
			topic.icons.push(getIconMarkup(topic.isSolved));
		}		
	});

	///----------------------------------------
	const promises = hookData.topics.map(async (topic, idx, topicArray) => {
		const postField = await posts.getPostFields(topic.mainPid, ['isAnonymous']);
		if (postField.isAnonymous) {
			/// 깊은 복사, user를 변경하면 topics의 모든 요소의 user가 변경된다
			topic.user = usernameCensor(topic.uid, {...topic.user});
			topic.uid = 0;

			if (topic.teaser && topic.teaser.user) {
				topic.teaser.user = usernameCensor(topic.teaser.uid, {...topic.teaser.user});
				topic.teaser.uid = 0;
			}
		}
	});
	await Promise.all(promises);
	///----------------------------------------

	return hookData;
};

plugin.addPostDataFilter = async function (hookData) {
	/// 글정보에 사용자, 에디터, 북마크, 투표 정보등을 추가하여 리턴하는 함수
	/// 대부분 글에 대한 정보 조회를 할때 이 함수가 호출됨
	/// filter:topics.addPostData 필터 훅 함수, Posts.addPostData() 함수내에서 호출되는 훅 필터함수
	hookData.posts.forEach((post) => {
		///----------------------------------------
		if (post && post.isAnonymous) {
			post.user = usernameCensor(post.uid, {...post.user});
			post.uid = 0;
		}
	});
	return hookData;
};

plugin.getPostsFromUserSetFilter = async function (hookData) {
	/// 프로필 정보 페이지에서 프로필주인이 작성한 글, 토푁, 팔로워 등에 대한 정보를 요청할때 호출됨
	/// 프로필 사용자가 작성한 글들이 익명글이라면, 프로필에서 노출되지 않도록 숨긴다
	
	const payload = hookData.res.locals.userData;

	if (hookData.data.type == "posts")
	{
		/// 이 함수는 posts.getPostSummariesFromSet() -> posts.getPostSummaryByPids() 호출시
		/// 호출된다. post 데이터에 isAnonymous필드를 채워서 리턴하지 않으므로 직접 쿼리 필요
		let newPosts = [];

		///	forEach는 await구문에 대해 처리결과를 기다려주지 않기 때문에 map()을 이용하였다
		const promises = hookData.itemData.posts.map(async (post, idx, postArray) => {
			const postField = await posts.getPostFields(post.pid, ['isAnonymous']);

			if (postField.isAnonymous != true) {
				newPosts.push(postArray[idx]);
				//console.log(idx, " ", post.topic.title);
			}
			// else {
			// 	console.log(idx, " ", post.topic.title, " ==> removed");
			// }
		});
		await Promise.all(promises);

		if (newPosts.length != hookData.itemData.posts.length)
		{
			hookData.itemData.posts = newPosts;
			hookData.itemCount = newPosts.length;
			payload.postcount = newPosts.length;
			//payload.counts.posts = newPosts.length;
		}
	}
	else if (hookData.data.type == "topics")
	{
		let newTopics = [];

		///	forEach는 await구문에 대해 처리결과를 기다려주지 않기 때문에 map()을 이용하였다
		const promises = hookData.itemData.topics.map(async (topic, idx, topicArray) => {
			const postField = await posts.getPostFields(topic.mainPid, ['isAnonymous']);
			if (postField.isAnonymous != true) {
				newTopics.push(topicArray[idx]);
				//console.log(idx, " ", topic.title);
			}
		});
		await Promise.all(promises);

		if (newTopics.length != hookData.itemData.topics.length)
		{
			hookData.itemData.topics = newTopics;
			hookData.itemCount = newTopics.length;
			payload.topiccount = newTopics.length;
			//payload.counts.topics = newTopics.length;
		}
	}

	return hookData;
};

function getIconMarkup(isSolved) {
	if (parseInt(isSolved, 10)) {
		return '<span class="answered badge border text-bg-success border-success"><i class="fa fa-check"></i><span> [[qanda:topic_solved]]</span></span>';
	}
	return '<span class="unanswered badge border text-bg-warning border-warning"><i class="fa fa-question-circle"></i><span> [[qanda:topic_unsolved]]</span></span>';
}

plugin.filterPostGetPostSummaryByPids = async function (hookData) {
	/// 답글을 막 작성하고 나서 호출되었다, filter:post.getPostSummaryByPids 필터 훅
	/// 프로필을 클릭했을 때 호출됨
	/// hookData는 caller, posts=[포스팅 요약정보]
	const tids = hookData.posts.map(p => p && p.tid);
	const topicData = await topics.getTopicsFields(tids, ['isQuestion', 'isSolved']);
	hookData.posts.forEach((p, index) => {
		if (p && p.topic && topicData[index]) {
			p.topic.isQuestion = parseInt(topicData[index].isQuestion, 10);
			p.topic.isSolved = parseInt(topicData[index].isSolved, 10);
		}
	});

	///----------------------------------------
	const promises = hookData.posts.map(async (post, idx, postArray) => {
		const postField = await posts.getPostFields(post.pid, ['isAnonymous']);
		if (postField.isAnonymous) {
			/// 깊은 복사, user를 변경하면 topics의 모든 요소의 user가 변경된다
			post.user = usernameCensor(post.uid, {...post.user});
			post.uid = 0;
		}
	});
	await Promise.all(promises);
	///----------------------------------------



	return hookData;
};

plugin.addThreadTool = async function (hookData) {
	///	토픽도구 클릭시 매뉴가 나올때 호출됨, 토픽이 질문이면 그에 맞는 토픽도구 매뉴 출력에 필요한 정보를 리턴, getTopic -> filter:topic.thread_tools
	/// 질문이면 해결로 표시, 일반토픽으로 지정을 리턴
	/// 질문이 아니면 질문으로 표시 설정 정보를 리턴한다
	/// hookData는 caller, tools=[], topic, uid=2 이 전달됨
	const isSolved = parseInt(hookData.topic.isSolved, 10);

	if (parseInt(hookData.topic.isQuestion, 10)) {
		hookData.tools = hookData.tools.concat([
			{
				class: `toggleSolved ${isSolved ? 'topic-solved' : 'topic-unsolved'}`,
				title: isSolved ? '[[qanda:thread.tool.mark_unsolved]]' : '[[qanda:thread.tool.mark_solved]]',
				icon: isSolved ? 'fa-question-circle' : 'fa-check-circle',
			},
			{
				class: 'toggleQuestionStatus',
				title: '[[qanda:thread.tool.make_normal]]',
				icon: 'fa-comments',
			},
		]);
	} else {
		hookData.tools.push({
			class: 'toggleQuestionStatus',
			title: '[[qanda:thread.tool.as_question]]',
			icon: 'fa-question-circle',
		});
	}
	return hookData;
};

plugin.addPostTool = async function (hookData) {
	/// 글 보기중 글도구(수정/신고 등이 있는 매뉴)를 클릭할때 호출된다, filter:post.tools
	/// hookData는 pid=30, post=글정보, tools=[], uid=2 
	///	getTopicDataByPid는 pid에 해당하는 토픽정보를 리턴한다
	const data = await topics.getTopicDataByPid(hookData.pid);
	if (!data) {
		return hookData;
	}

	///	isSolved, isQuestion값을 한번 더 검사하여 지정한다
	data.isSolved = parseInt(data.isSolved, 10) === 1;
	data.isQuestion = parseInt(data.isQuestion, 10) === 1;
	///	현재 사용자가 tid토픽에 대해 해결됨 설정이 가능한 사용자라면
	const canSolve = await canSetAsSolved(data.tid, hookData.uid);
	/// 질문토픽이고 선택한 글이 해결된 글이 아니고, 선택한 글이 토픽글pid가 아니면
	///	사용자가 해결글 이라고 설정할 수 있도록 매뉴표현 정보를 tools를 추가한다
	if (canSolve && data.isQuestion &&
		parseInt(hookData.pid, 10) !== parseInt(data.solvedPid, 10) &&
		parseInt(hookData.pid, 10) !== parseInt(data.mainPid, 10)) {
		hookData.tools.push({
			action: 'qanda/post-solved',
			html: '[[qanda:post.tool.mark_correct]]',
			icon: 'fa-check-circle',
		});
	}
	return hookData;
};

plugin.getConditions = async function (conditions) {
	/// filter:rewards.conditions 필터훅, 관리자 설정에서 리워드 매뉴 클릭시 호출됨, 리워드에 해결된 질문수를 추가한다
	conditions.push({
		name: 'Times questions accepted',
		condition: 'qanda/question.accepted',
	});
	return conditions;
};

plugin.onTopicCreate = async function (payload) {
	/// filter:topic.create 필터 훅, 토픽생성하고 작성완료를 눌렀을 때 호출
	/// 생성되는 토픽에 질문글로 취급하는 필드를 추가
	let isQuestion;
	if (payload.data.hasOwnProperty('isQuestion')) {
		isQuestion = true;
	}

	if (payload.data.hasOwnProperty('isAnonymous')) {
		//await posts.setPostFields(hookData.topic.pid, { isAnonymous: 1});

		/// hookData.post와 hookData.data 를 전달받는데, hookData.post가 caller에서 사용된다
		//uid를 0으로 설정하여 익명으로 글 쓴 것처럼 처리한다
		payload.topic.uid = 0;
		payload.topic.handle = "<비노출>";
	}

	/// 플러긴 옵션에 강제로 질문글로 등록이 on이거나 현재 cid가 질문글카테고리로 지정된 경우라면
	// Overrides from ACP config
	if (plugin._settings.forceQuestions === 'on' || plugin._settings[`defaultCid_${payload.topic.cid}`] === 'on') {
		isQuestion = true;
	}

	if (!isQuestion) {
		return payload;
	}

	await topics.setTopicFields(payload.topic.tid, { isQuestion: 1, isSolved: 0 });
	await db.sortedSetAdd('topics:unsolved', Date.now(), payload.topic.tid);
	return payload;
};

plugin.onPostCreate = async function (hookData) {
	/// filter:post.create 글작성완료를 눌렀을 때 호출
	/// 생성되는 글에 익명글 취급하는 필드를 추가
	if (hookData.data.hasOwnProperty('isAnonymous')) {
		await posts.setPostFields(hookData.post.pid, { isAnonymous: 1});

		/// hookData.post와 hookData.data 를 전달받는데, hookData.post가 caller에서 사용된다
		//uid를 0으로 설정하여 익명으로 글 쓴 것처럼 처리한다
		hookData.post.uid = 0;
		hookData.data.handle = "<비노출>";
	}

	return hookData;
};

plugin.onPostEdit = async function (hookData) {
	/// 글 편집이 완료됐을때 호출됨, filter:post.edit
	const isAnonymous = hookData.data.isAnonymous === true || parseInt(hookData.data.isAnonymous, 10) === 1;
	await posts.setPostFields(hookData.data.pid, { isAnonymous: isAnonymous});

	if (isAnonymous) {
		hookData.post.uid = 0;
		hookData.post.handle = "<비노출>";
		hookData.post.editor = 0;
	}
	else {
		hookData.post.uid = hookData.data.uid;
		// pid가 mainPid면 topic의 uid도 같이 수정해주어야 함
		// 안그러면 post-list에서는 작성자가 공개되는데, 토픽리스트에서는 여전히 비공개 됨
		/// 한가지 더! 프로필 리스트에서 이 작성자가 작성한 글이 안나옴
		/// hookData.post는 pid만 넘어오므로, tid를 구하려면
		const postData = await posts.getPostData(hookData.data.pid);
		if (postData && postData.tid) {
			const topicData = await topics.getTopicFields(postData.tid, ['mainPid']);
			if (topicData && topicData.mainPid == hookData.data.pid) {
				await topics.setTopicFields(postData.tid, {uid: hookData.data.uid});
			}
		}
	}
	
	/// TODO: 
	/// 또다시 익명 옵션이 있으면, hookData.handle 에 값을 써주어야 filter이후 값을 저장할 것이다
	/// hookData.data.isAnonymous가 있으면 
	/// uid와 handle을 0 처리
	/// 없으면 공개로 전환하는 것이므로
	/// filter.data.uid가 0이 아니면, 실제 아이디로 작성하는 것임

	return hookData;
};

plugin.onTeasersGet = async function (hookData) {
	/// 카테고리 목록화 접근시 각 카테고리의 마지막 글(티저정보)정보를 구할 떄 호출됨
	///----------------------------------------
	const promises = hookData.teasers.map(async (teaser, idx, teasersArray) => {
		/// 헉.. 티저정보가 undefined로 채워진 배열이 있을 수 있다, 아마 아무글도 안써진 카테고리가
		/// 있으면 그러하다
		if (teaser) {
			const postField = await posts.getPostFields(teaser.pid, ['isAnonymous']);
			if (postField.isAnonymous) {
				teaser.user = usernameCensor(teaser.uid, {...teaser.user});
				teaser.uid = 0;
			}
		}
	});
	await Promise.all(promises);
	///----------------------------------------

	return hookData;
};

plugin.actionTopicSave = async function (hookData) {
	/// 토픽 생성작성후 컴포저에서 제출 눌렀을 때 호출되며, 제출버튼 옵션이 질문글로 올리기로 하였다면 토픽글로 설정한다
	if (hookData.topic && hookData.topic.isQuestion) {
		await db.sortedSetAdd(hookData.topic.isSolved === 1 ? 'topics:solved' : 'topics:unsolved', Date.now(), hookData.topic.tid);
	}
};

plugin.filterTopicEdit = async function (hookData) {
	/// 토픽편집이 완료됐을때 호출됨
	/// 질문글로 설정해서 제출했는지 여부와 이미 질문글로 설정되었는지 여부와 비교해서 다르면 
	const isNowQuestion = hookData.data.isQuestion === true || parseInt(hookData.data.isQuestion, 10) === 1;
	const wasQuestion = parseInt(await topics.getTopicField(hookData.topic.tid, 'isQuestion'), 10) === 1;
	if (isNowQuestion !== wasQuestion) {
		await toggleQuestionStatus(hookData.req.uid, hookData.topic.tid);
	}

	return hookData;
};

plugin.actionTopicPurge = async function (hookData) {
	/// 호출시점
	if (hookData.topic) {
		await db.sortedSetsRemove(['topics:solved', 'topics:unsolved'], hookData.topic.tid);
	}
};

plugin.filterComposerPush = async function (hookData) {
	/// 글 편집시 호출, 현재 편집중인 글이 질문글인지 여부를 확인해서 hookData.isQuestion값으로 설정, hookData.tid가 이미 있음에도 아래처럼 getPostField()를 통해 또 구하는 것이 이상
	const tid = await posts.getPostField(hookData.pid, 'tid');
	const isQuestion = await topics.getTopicField(tid, 'isQuestion');
	hookData.isQuestion = isQuestion;

	// if (hookData.cid == 16) {
	// 	hookData.
	// }

	return hookData;
};

plugin.filterComposerTopicPush = async function (hookData) {
	/// 여기가 호출되면 좋겠지만, 호출안된다.
	///	composer에서 newTopic을 생성할때 호출된다. 여기에 익명글 작성 대상 카테고리 정보를 넣을 수 있다
	/// https://github.com/NodeBB/nodebb-plugin-composer-default/blob/master/static/lib/composer.js#L546-L573
	return hookData;
};

plugin.filterComposerBuild = async function (hookData) {
	/// 콤포저가 작성완료되었을떄 호출을 예상하나 실제론 호출이 안된다
	console.log("-------------- filterComposerBuild --------------");
	//hookData.templateData.canPostAnonymous = true;
	return hookData;
};

plugin.staticApiRoutes = async function ({ router, middleware, helpers }) {
	/// static:api.routes 훅함수, 플러긴 로딩시 호출됨
	/// 
	router.get('/qna/:tid', middleware.assert.topic, async (req, res) => {
		/// isAnonymous 필드에 대한 접근 처리
		let { isQuestion, isSolved, isAnonymous } = await topics.getTopicFields(req.params.tid, ['isQuestion', 'isSolved', 'isAnonymous']);
		isQuestion = isQuestion || '0';
		isSolved = isSolved || '0';
		isAnonymous = isAnonymous || '0';
		helpers.formatApiResponse(200, res, { isQuestion, isSolved, isAnonymous });
	});

	//router.get('/anonpost/:check', middleware.assert.topic, async (req, res) => {
	router.get('/canpost', async (req, res, next) => {
		let cid = req.query.cid;
		let tid = req.query.tid;

		if (!cid && req.query.pid) {
			const post = await posts.getPostFields(req.query.pid, ['tid']);
			tid = post.tid;
		}

		if (!cid && tid) {
			const topic = await topics.getTopicFields(tid, ['cid']);
			cid = topic.cid;
		}

		/// isAnonymous 필드에 대한 접근 처리
		let canPostAnonymous = false;
		let canPostQuestion = false;
		if (cid && cid == 16)
			canPostAnonymous = true;

		helpers.formatApiResponse(200, res, { canPostQuestion, canPostAnonymous });
	});	
};

plugin.registerTopicEvents = async function ({ types }) {
	/// filter:topicEvents.init 필터훅, nodebb초기화시 호출되며, 플러긴에서 사용할 아이콘과 그에 해당하는 언어번역함수를 types에 추가하고 리턴함
	///
	types['qanda.as_question'] = {
		icon: 'fa-question',
		translation: async (event, language) => topics.events.translateSimple(event, language, 'qanda:thread.alert.as_question'),
	};
	types['qanda.make_normal'] = {
		icon: 'fa-question',
		translation: async (event, language) => topics.events.translateSimple(event, language, 'qanda:thread.alert.make_normal'),
	};
	types['qanda.solved'] = {
		icon: 'fa-check',
		translation: async (event, language) => topics.events.translateSimple(event, language, 'qanda:thread.alert.solved'),
	};
	types['qanda.unsolved'] = {
		icon: 'fa-question',
		translation: async (event, language) => topics.events.translateSimple(event, language, 'qanda:thread.alert.unsolved'),
	};
	return { types };
};

async function renderAdmin(req, res) {
	///	모든 카테고리 목록에서 cid, name, parentCid를 구하고 해당 정보를 템플릿에 전달하여 트리형태로 그려준다
	const cids = await db.getSortedSetRange('categories:cid', 0, -1);
	const data = await categories.getCategoriesFields(cids, ['cid', 'name', 'parentCid']);
	res.render('admin/plugins/question-and-answer', {
		categories: categories.getTree(data),
		title: 'X-Topic',
	});
}

function handleSocketIO() {
	SocketPlugins.QandA = {};

	SocketPlugins.QandA.toggleSolved = async function (socket, data) {
		/// 호출시점
		/// 호출시점
		const canSolve = await canSetAsSolved(data.tid, socket.uid);
		if (!canSolve) {
			throw new Error('[[error:no-privileges]]');
		}

		return await toggleSolved(socket.uid, data.tid);
	};


	SocketPlugins.QandA.markPostAsAnswer = async function (socket, data) {
		/// 호출시점
		/// 호출시점
		const canSolve = await canSetAsSolved(data.tid, socket.uid);
		if (!canSolve) {
			throw new Error('[[error:no-privileges]]');
		}

		return await markSolved(socket.uid, data.tid, data.pid, true);
	};

	SocketPlugins.QandA.toggleQuestionStatus = async function (socket, data) {
		/// 토픽도구에서 일반글/질문글로 지정 매뉴를 클릭시,  
		const canSolve = await canSetAsSolved(data.tid, socket.uid);
		if (!canSolve) {
			throw new Error('[[error:no-privileges]]');
		}

		return await toggleQuestionStatus(socket.uid, data.tid);
	};
}

async function toggleSolved(uid, tid) {
	/// 해결/미해결을 토글 설정한다
	let isSolved = await topics.getTopicField(tid, 'isSolved');
	isSolved = parseInt(isSolved, 10) === 1;
	return await markSolved(uid, tid, 0, !isSolved);
}

async function markSolved(uid, tid, pid, isSolved) {
	/// 해결여부값(isSolved)에 따른 토픽에서 수정해야 할 필드값을 준비하고, 이 값들로 tid에 존재하는 필드를 업데이트 한다
	/// 
	const updatedTopicFields = isSolved ?
		{ isSolved: 1, solvedPid: pid }	:
		{ isSolved: 0, solvedPid: 0 };

	if (plugin._settings.toggleLock === 'on') {
		updatedTopicFields.locked = isSolved ? 1 : 0;
	}

	await topics.setTopicFields(tid, updatedTopicFields);

	if (isSolved) {
		/// pid를 해결글로 채택헀다면, 토픽에 topics:solved 필드를 설정하고 이벤트로 남긴다. 
		await Promise.all([
			db.sortedSetRemove('topics:unsolved', tid),
			db.sortedSetAdd('topics:solved', Date.now(), tid),
			topics.events.log(tid, { type: 'qanda.solved', uid }),
		]);
		if (pid) {
			const data = await posts.getPostData(pid);
			await rewards.checkConditionAndRewardUser({
				uid: data.uid,
				condition: 'qanda/question.accepted',
				method: async function () {
					await user.incrementUserFieldBy(data.uid, 'qanda/question.accepted', 1);
				},
			});
		}
	} else {
		/// 미해결로 설정한다면 topics:unsolved 필드를 설정하고 이벤트로 남긴다
		await Promise.all([
			db.sortedSetAdd('topics:unsolved', Date.now(), tid),
			db.sortedSetRemove('topics:solved', tid),
			topics.events.log(tid, { type: 'qanda.unsolved', uid }),
		]);
	}

	plugins.hooks.fire('action:topic.toggleSolved', { uid: uid, tid: tid, pid: pid, isSolved: isSolved });
	return { isSolved: isSolved };
}

async function toggleQuestionStatus(uid, tid) {
	/// 호출시점: 토픽도구에서 일반글/질문글로 지정 매뉴를 클릭시
	/// tid에 해당하는 토픽이 질문글이면 질문글여부/해결여부/채택글pid 값을 토픽에 추가, 일반글로 전환한다면 질문글정보를 삭제하고, 토글결과를 리턴함
	let isQuestion = await topics.getTopicField(tid, 'isQuestion');
	isQuestion = parseInt(isQuestion, 10) === 1;

	if (!isQuestion) {
		await Promise.all([
			topics.setTopicFields(tid, { isQuestion: 1, isSolved: 0, solvedPid: 0 }),
			db.sortedSetAdd('topics:unsolved', Date.now(), tid),
			db.sortedSetRemove('topics:solved', tid),
			topics.events.log(tid, { type: 'qanda.as_question', uid }),
		]);
	} else {
		await Promise.all([
			topics.deleteTopicFields(tid, ['isQuestion', 'isSolved', 'solvedPid']),
			db.sortedSetsRemove(['topics:solved', 'topics:unsolved'], tid),
			topics.events.log(tid, { type: 'qanda.make_normal', uid }),
		]);
	}

	plugins.hooks.fire('action:topic.toggleQuestion', { uid: uid, tid: tid, isQuestion: !isQuestion });
	return { isQuestion: !isQuestion };
}

async function canPostTopic(uid) {
	///	모든 카테고리id에서 주어진 uid로 접근가능한 카테고리인지 확인하여 결과를 리턴
	let cids = await categories.getAllCidsFromSet('categories:cid');
	///>>> 여기 cids값을 어떻게 처리하여 권한 검사를 해서 토픽작성가능한지 체크 원리가 궁금하다
	cids = await privileges.categories.filterCids('topics:create', cids, uid);
	return cids.length > 0;
}

async function renderUnsolved(req, res) {
	await renderQnAPage('unsolved', req, res);
}

async function renderSolved(req, res) {
	await renderQnAPage('solved', req, res);
}

async function renderQnAPage(type, req, res) {
	///	qna페이지를 그리기 전 사용자 정보와 접근권한을 검사한다
	const page = parseInt(req.query.page, 10) || 1;
	const { cid } = req.query;
	const [settings, categoryData, canPost, isPrivileged] = await Promise.all([
		user.getSettings(req.uid),
		helpers.getSelectedCategory(cid),
		canPostTopic(req.uid),
		user.isPrivileged(req.uid),
	]);

	const topicsData = await getTopics(type, page, cid, req.uid, settings);

	const data = {};
	data.topics = topicsData.topics;
	data.showSelect = isPrivileged;
	data.showTopicTools = isPrivileged;
	data.allCategoriesUrl = type + helpers.buildQueryString(req.query, 'cid', '');
	data.selectedCategory = categoryData.selectedCategory;
	data.selectedCids = categoryData.selectedCids;

	data['feeds:disableRSS'] = true;
	const pageCount = Math.max(1, Math.ceil(topicsData.topicCount / settings.topicsPerPage));
	data.pagination = pagination.create(page, pageCount);
	data.canPost = canPost;
	data.title = `[[qanda:menu.${type}]]`;

	if (req.path.startsWith(`/api/${type}`) || req.path.startsWith(`/${type}`)) {
		data.breadcrumbs = helpers.buildBreadcrumbs([{ text: `[[qanda:menu.${type}]]` }]);
	}

	res.render('recent', data);
}

async function getTopics(type, page, cids, uid, settings) {
	/// filter:topics.get 에대한 훅함수
	///	토픽을 가져오기 전 권한검사를 하고 tids를 구하고 토픽데이터를 구하여 리턴
	///>>> 여기도 어떤 쿼리를 날려서 어떻게 동작하는지 잘 모르겠다.
	cids = cids || [];
	if (!Array.isArray(cids)) {
		cids = [cids];
	}
	const set = `topics:${type}`;
	let tids = [];
	if (cids.length) {
		/// 
		cids = await privileges.categories.filterCids('read', cids, uid);
		const allTids = await Promise.all(cids.map(async cid => await db.getSortedSetRevIntersect({
			sets: [set, `cid:${cid}:tids:lastposttime`],
			start: 0,
			stop: 199,
		})));
		tids = allTids.flat().sort((tid1, tid2) => tid2 - tid1);
	} else {
		///
		tids = await db.getSortedSetRevRange(set, 0, 199);
		tids = await privileges.topics.filterTids('read', tids, uid);
	}

	const start = Math.max(0, (page - 1) * settings.topicsPerPage);
	const stop = start + settings.topicsPerPage - 1;

	const topicCount = tids.length;

	tids = tids.slice(start, stop + 1);

	const topicsData = await topics.getTopicsByTids(tids, uid);
	topics.calculateTopicIndices(topicsData, start);
	return {
		topicCount,
		topics: topicsData,
	};
}

async function canSetAsSolved(tid, uid) {
	///	uid	사용자가 tid에 대해 해겸됨이라고 설정할 수 있는지 검사
	if (plugin._settings.onlyAdmins === 'on') {
		return await privileges.topics.isAdminOrMod(tid, uid);
	}
	return await privileges.topics.canEdit(tid, uid);
}

function usernameCensor(censorUid, userInfo) {
	/// user개체에서 username, displayname, fullname 필드를 비노출 처리함
	/// TODO: pid 또는 tid에 해당하는 정보가 isUncensor값이 true일때 적용해야 함
	if (userInfo.uid == censorUid) {
		if (userInfo.displayname) {
			userInfo.displayname = "<비노출>";
		}
		if (userInfo.username) {
			userInfo.username = "<비노출>";
		}

		if (userInfo.fullname) {
			userInfo.fullname = "<비노출>";
		}
		if (userInfo.userslug) {
			userInfo.userslug = "#";
		}

		if (userInfo.uid) {
			userInfo.uid = 0;
		}

		if (userInfo.picture) {
			userInfo.picture = user.getDefaultAvatar();
		}		

		if (userInfo['icon:text']) {
			userInfo['icon:text'] = '?';
		}
		if (userInfo['icon:bgColor']) {
			userInfo['icon:bgColor'] = '#aaa';
		}		
		//icon:bgColor;
	}

	return userInfo;
}
