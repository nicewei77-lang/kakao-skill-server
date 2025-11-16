# 카카오 챗봇 스킬 서버

카카오 챗봇 스킬 서버용 최소 Express 서버입니다.

## 목표

카카오 챗봇 → Render 서버 → "OK - Render 연결 성공" 텍스트 응답

---

## 1단계: 로컬 환경 설정 및 테스트

### 1.1 의존성 설치

터미널에서 다음 명령어를 실행하세요:

```bash
# npm 초기화 (이미 package.json이 있으면 생략 가능)
npm init -y

# Express 설치
npm install express
```

### 1.2 서버 실행

```bash
npm start
```

또는

```bash
node index.js
```

서버가 실행되면 다음과 같은 메시지가 표시됩니다:
```
Server listening on port 3000
```

### 1.3 로컬 테스트

#### 테스트 1: 헬스체크 엔드포인트

브라우저에서 다음 URL을 열거나:

```
http://localhost:3000/
```

터미널에서 curl 명령어로 테스트:

```bash
curl http://localhost:3000/
```

**예상 응답:** `Linkus skill server OK`

#### 테스트 2: 카카오 스킬 엔드포인트

터미널에서 다음 명령어를 실행:

```bash
curl -X POST http://localhost:3000/kakao \
  -H "Content-Type: application/json" \
  -d '{}'
```

**예상 응답:**
```json
{
  "version": "2.0",
  "template": {
    "outputs": [
      {
        "simpleText": {
          "text": "OK - Render 연결 성공"
        }
      }
    ]
  }
}
```

---

## 2단계: Render에 배포하기

### 2.1 GitHub에 코드 업로드

현재 레포지토리를 GitHub에 올립니다:

```bash
# Git 초기화 (이미 초기화되어 있으면 생략)
git init

# 파일 추가
git add .

# 커밋
git commit -m "Initial commit: 카카오 스킬 서버 최소 구현"

# GitHub 원격 저장소 추가 (YOUR_USERNAME과 YOUR_REPO_NAME을 실제 값으로 변경)
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git

# 메인 브랜치로 푸시
git branch -M main
git push -u origin main
```

### 2.2 Render에서 Web Service 생성

1. [Render 대시보드](https://dashboard.render.com/)에 로그인
2. **"New +"** 버튼 클릭 → **"Web Service"** 선택
3. GitHub 레포지토리 연결 및 선택
4. 다음 설정값 입력:

   - **Name**: 원하는 서비스 이름 (예: `kakao-skill-server`)
   - **Environment**: `Node`
   - **Build Command**: (비워두거나 `npm install` 입력)
   - **Start Command**: `node index.js` 또는 `npm start`
   - **Port**: 비워두기 (Render가 자동으로 `PORT` 환경변수 설정)

5. **"Create Web Service"** 클릭

### 2.3 배포 완료 확인

배포가 완료되면 다음과 같은 URL이 생성됩니다:

- `https://<your-service-name>.onrender.com/`
- `https://<your-service-name>.onrender.com/kakao`

#### 배포된 서버 테스트

**테스트 1: 헬스체크**
```bash
curl https://<your-service-name>.onrender.com/
```

**예상 응답:** `Linkus skill server OK`

**테스트 2: 카카오 스킬 엔드포인트**
```bash
curl -X POST https://<your-service-name>.onrender.com/kakao \
  -H "Content-Type: application/json" \
  -d '{}'
```

**예상 응답:**
```json
{
  "version": "2.0",
  "template": {
    "outputs": [
      {
        "simpleText": {
          "text": "OK - Render 연결 성공"
        }
      }
    ]
  }
}
```

---

## 3단계: 카카오 챗봇 관리자센터 설정

### 3.1 스킬 생성

1. [카카오톡 챗봇 관리자센터](https://chatbot.kakao.com/)에 로그인
2. **"스킬"** 메뉴 → **"스킬 목록"** 클릭
3. **"새 스킬 만들기"** 버튼 클릭
4. 다음 정보 입력:

   - **스킬 이름**: 원하는 이름 (예: `Render 연결 테스트`)
   - **스킬 URL**: `https://<your-service-name>.onrender.com/kakao`
   - **헤더**: 비워두기
   - **파라미터**: 비워두기

5. **"저장"** 클릭

### 3.2 스킬 테스트

1. 생성한 스킬의 **"스킬 테스트"** 버튼 클릭
2. **"스킬서버로 전송"** 클릭
3. 응답 JSON에서 다음을 확인:

   ```json
   {
     "version": "2.0",
     "template": {
       "outputs": [
         {
           "simpleText": {
             "text": "OK - Render 연결 성공"
           }
         }
       ]
     }
   }
   ```

4. 응답에 `"OK - Render 연결 성공"` 텍스트가 포함되어 있으면 **성공**입니다!

---

## 파일 구조

```
.
├── package.json      # 프로젝트 설정 및 의존성
├── index.js          # Express 서버 메인 파일
└── README.md         # 이 문서
```

---

## 참고사항

- 포트는 `process.env.PORT` 환경변수를 사용합니다. Render는 자동으로 이 값을 설정합니다.
- 로컬에서는 기본값으로 3000 포트를 사용합니다.
- 이 서버는 최소 구현이며, 실제 스프레드시트 연동이나 본인인증 로직은 포함되어 있지 않습니다.

