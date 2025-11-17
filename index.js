const express = require('express');
const app = express();

app.use(express.json());

// Kakao 스킬 서버 엔드포인트 (로그 확인용 1단계 버전)
app.post('/kakao', (req, res) => {
  console.log('===== Kakao request body =====');
  console.dir(req.body, { depth: 5 });

  return res.json({
    version: "2.0",
    template: {
      outputs: [
        {
          simpleText: {
            text: "OK - Kakao 요청 로그 확인"
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
