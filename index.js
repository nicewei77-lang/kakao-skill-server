const express = require('express');
const app = express();

app.use(express.json());

// Kakao 스킬 엔드포인트
app.post('/kakao', (req, res) => {
  const body = req.body || {};
  const action = body.action || {};
  const params = action.params || {};

  const userName = params.user_name || '이름 미입력';
  const userPhone4 = params.user_phone4 || '번호 미입력';

  console.log('인증 요청 - 이름:', userName, '전화 뒤 4자리:', userPhone4);

  return res.json({
    version: "2.0",
    template: {
      outputs: [
        {
          simpleText: {
            text:
              `본인인증 요청 정보\n` +
              `이름: ${userName}\n` +
              `전화번호 뒤 4자리: ${userPhone4}`
          }
        }
      ]
    }
  });
});

// 헬스체크용 루트 엔드포인트
app.get('/', (req, res) => {
  res.send('Linkus skill server OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
