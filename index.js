const express = require('express');
const app = express();

// JSON 파싱 미들웨어
app.use(express.json());

// 카카오 스킬 서버용 엔드포인트
app.post('/kakao', (req, res) => {
  return res.json({
    version: "2.0",
    template: {
      outputs: [
        { simpleText: { text: "OK - Render 연결 성공" } }
      ]
    }
  });
});

// 헬스체크용 루트 엔드포인트
app.get('/', (req, res) => res.send('Linkus skill server OK'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

