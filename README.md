# QnA, 작성자비노출을 지원하는 nodebb 플러긴

nodebb-plugin-question-and-answer 플러긴을 수정하여 작성자 비노출 기능을 추가한 플러긴입니다.

> This project is a modified version of [nodebb-plugin-question-and-answer](https://github.com/NodeBB/nodebb-plugin-question-and-answer). Original project is licensed under the MIT. Modifications were made by seyool.



## 변경사항

### 1. 사용자명 비노출 옵션 제공

익명성 보장은 어떤 경우에 있어 글쓰기에 대한 망설임을 줄여줍니다. 이는 커뮤니티 규모 확장에 필수적인 요소인 사용자 유입에 도움이 됩니다. 

nodebb는 guest에 대한 글쓰기를 허용하는 옵션이 제공되나, 익명으로 글작성이후 글에 대한 권한을 원 소유자가 가질 수 없습니다. 

예시: 글 작성이후 삭제/수정 불가, 글에 대한 여러가지 통보수신(Notification) 불가 등

때문에 사용자가 작성한 글에 대한 권한을 유지하면서 사용자 보인임을 드러내는 사용자명을 비노출로 처리해서 작성할 수 있는 기능이 필요했습니다.



### 2. 한국어 지원

플러긴에 한국어 번역을 추가하였습니다








