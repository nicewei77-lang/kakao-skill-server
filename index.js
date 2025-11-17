app.post('/kakao', (req, res) => {
  console.log('===== Kakao request body =====');
  console.dir(req.body, { depth: 5 });

  return res.json({
    version: "2.0",
    template: {
      outputs: [
        { simpleText: { text: "OK - Kakao 요청 로그 확인" } }
      ]
    }
  });
});

