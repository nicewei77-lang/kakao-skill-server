// index.js
const express = require('express');
const { google } = require('googleapis');

const app = express();
app.use(express.json());

// ======================================
// 1. Google Sheets 공통 설정
// ======================================

// ─ 본인인증용 명단 시트 ─
const AUTH_SPREADSHEET_ID = '1F_pq-dE_oAi_nJRThSjP5-QA-c8mmzJ5hA5mSbJXH60';
const AUTH_SHEET_NAME = '시트1';
const AUTH_RANGE = `${AUTH_SHEET_NAME}!A4:S`;

// 열 인덱스 (0부터, A=0, B=1, C=2 ...)
// 스태프 영역
const COL_STAFF_NAME = 2;   // C열: 스태프 이름
const COL_STAFF_PHONE = 8;  // I열: 스태프 연락처

// 멤버 영역
const COL_MEMBER_NAME = 11;  // L열: 멤버 이름
const COL_MEMBER_PHONE = 17; // R열: 멤버 전화번호

// ─ 출석부 시트 ─
const ATT_SPREADSHEET_ID = '1ujB1ZLjmXZXmkQREINW7YojdoXEYBN7gUlXCVTNUswM';
const ATT_SHEET_NAME = '출석부';
const ATT_RANGE = `${ATT_SHEET_NAME}!A5:Q`; // 5행부터 데이터라고 가정

// 출석부 열 인덱스
const COL_ATT_NAME = 2;  // C열: 이름
const COL_OUT_N = 13;    // N열: 아웃카운트(출석)
const COL_OUT_P = 15;    // P열: 8월 출석 포함 아웃카운트

// ======================================
// 2. Google Sheets 클라이언트
// ======================================

function createSheetsClient() {
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!rawKey) {
    throw new Error('환경변수 GOOGLE_SERVICE_ACCOUNT_KEY 가 설정되어 있지 않습니다.');
  }

  const credentials = JSON.parse(rawKey);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  return google.sheets({ version: 'v4', auth });
}

// ======================================
// 3. 본인인증: 이름 + 전화 뒤 4자리 찾기
// ======================================

async function findPersonByNameAndPhone4(name, phone4) {
  const sheets = createSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: AUTH_SPREADSHEET_ID,
    range: AUTH_RANGE,
  });

  const rows = res.data.values || [];
  if (!rows.length) return null;

  const targetName = (name || '').trim();
  const targetPhone4 = (phone4 || '').trim();

  for (const row of rows) {
    // 스태프 전화번호
    const staffPhone = (row[COL_STAFF_PHONE] || '').toString();
    const staffDigits = staffPhone.replace(/[^0-9]/g, '');
    const staffLast4 = staffDigits.slice(-4);

    // 멤버 전화번호
    const memberPhone = (row[COL_MEMBER_PHONE] || '').toString();
    const memberDigits = memberPhone.replace(/[^0-9]/g, '');
    const memberLast4 = memberDigits.slice(-4);

    // 1) 멤버 먼저
    const memberName = (row[COL_MEMBER_NAME] || '').trim();
    if (
      memberName &&
      memberDigits &&
      memberLast4 === targetPhone4 &&
      memberName === targetName
    ) {
      return {
        role: '멤버',
        name: memberName,
        phone4: memberLast4,
      };
    }

    // 2) 스태프
    const staffName = (row[COL_STAFF_NAME] || '').trim();
    if (
      staffName &&
      staffDigits &&
      staffLast4 === targetPhone4 &&
      staffName === targetName
    ) {
      return {
        role: '스태프',
        name: staffName,
        phone4: staffLast4,
      };
    }
  }

  return null;
}

// ======================================
// 4. 출석부: 이름으로 아웃카운트 찾기
// ======================================

async function findAttendanceByName(name) {
  const sheets = createSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: ATT_SPREADSHEET_ID,
    range: ATT_RANGE,
  });

  const rows = res.data.values || [];
  if (!rows.length) return null;

  const targetName = (name || '').trim();

  const parseOut = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const num = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
    return Number.isNaN(num) ? null : num;
  };

  for (const row of rows) {
    const rowName = (row[COL_ATT_NAME] || '').trim();
    if (!rowName) continue;

    if (rowName === targetName) {
      const outN = parseOut(row[COL_OUT_N]);
      const outP = parseOut(row[COL_OUT_P]);
      const totalOut = outP !== null ? outP : outN; // P가 있으면 P, 없으면 N

      return {
        name: rowName,
        totalOut,
      };
    }
  }

  return null;
}

// ======================================
// 5. 간단 세션: 마지막 본인인증 결과
// ======================================

// key: kakao user id, value: { name, role, phone4 }
const lastAuthByUserId = new Map();

// ======================================
// 6. Kakao 스킬 - 본인인증 (/kakao)
// ======================================

app.post('/kakao', async (req, res) => {
  const body = req.body || {};
  const action = body.action || {};
  const params = action.params || {};
  const userRequest = body.userRequest || {};
  const user = userRequest.user || {};
  const kakaoUserId = user.id || null;

  const userName = params.user_name || '';
  const userPhone4 = params.user_phone4 || '';

  console.log('인증 요청 - 이름:', userName, '전화 뒤 4자리:', userPhone4);

  if (!userName || !userPhone4) {
    const msg = [
      '이름과 전화번호 뒤 4자리를 모두 입력해야 본인인증이 가능합니다.',
      '다시 시도해주세요.',
    ].join('\n');

    return res.json({
      version: '2.0',
      template: {
        outputs: [
          {
            simpleText: { text: msg },
          },
        ],
      },
    });
  }

  try {
    const person = await findPersonByNameAndPhone4(userName, userPhone4);

    if (!person) {
      const msg = [
        '입력하신 정보와 일치하는 인원을 찾지 못했습니다.',
        '이름과 전화번호 뒤 4자리를 다시 한 번 확인해주세요.',
        '(그래도 안 되면 운영진에게 문의해주세요.)',
      ].join('\n');

      return res.json({
        version: '2.0',
        template: {
          outputs: [
            {
              simpleText: { text: msg },
            },
          ],
        },
      });
    }

    // 세션에 인증정보 저장
    if (kakaoUserId) {
      lastAuthByUserId.set(kakaoUserId, {
        name: person.name,
        role: person.role,
        phone4: person.phone4,
      });
    }

    const msg = [
      `${person.name}님, 본인인증이 완료되었습니다 ✅`,
      `• 구분: ${person.role}`,
      '',
      '이제 아래 버튼을 눌러 출석 현황을 확인할 수 있습니다.',
    ].join('\n');

    return res.json({
      version: '2.0',
      template: {
        outputs: [
          {
            simpleText: { text: msg },
          },
        ],
        quickReplies: [
          {
            label: '출석 현황 보기',
            action: 'message',
            messageText: '출석 조회', // 출석조회 블록 패턴과 맞추기
          },
        ],
      },
    });
  } catch (err) {
    console.error('본인인증 처리 중 오류:', err);

    const msg = [
      '본인인증 처리 중 내부 오류가 발생했습니다.',
      '잠시 후 다시 시도해 주세요.',
      '(지속되면 운영진에게 문의해주세요.)',
    ].join('\n');

    return res.json({
      version: '2.0',
      template: {
        outputs: [
          {
            simpleText: { text: msg },
          },
        ],
      },
    });
  }
});

// ======================================
// 7. Kakao 스킬 - 출석조회 (/attendance)
// ======================================

app.post('/attendance', async (req, res) => {
  const body = req.body || {};
  const userRequest = body.userRequest || {};
  const user = userRequest.user || {};
  const kakaoUserId = user.id || null;

  if (!kakaoUserId) {
    const msg = [
      '사용자 정보를 확인할 수 없습니다.',
      '다시 시도해 주세요.',
    ].join('\n');

    return res.json({
      version: '2.0',
      template: {
        outputs: [
          {
            simpleText: { text: msg },
          },
        ],
      },
    });
  }

  const session = lastAuthByUserId.get(kakaoUserId);

  if (!session || !session.name) {
    const msg = [
      '먼저 본인인증이 필요합니다.',
      '출석 현황 메뉴에서 [본인확인]을 다시 진행해 주세요.',
    ].join('\n');

    return res.json({
      version: '2.0',
      template: {
        outputs: [
          {
            simpleText: { text: msg },
          },
        ],
      },
    });
  }

  try {
    const attendance = await findAttendanceByName(session.name);

    if (!attendance || attendance.totalOut === null) {
      const msg = [
        `${session.name}님의 출석 정보를 찾지 못했습니다.`,
        '운영진에게 출석부 등록 여부를 확인해 주세요.',
      ].join('\n');

      return res.json({
        version: '2.0',
        template: {
          outputs: [
            {
              simpleText: { text: msg },
            },
          ],
        },
      });
    }

    const msg = [
      `${session.name}님의 출석 현황입니다.`,
      '',
      `총 아웃카운트: ${attendance.totalOut} OUT`,
      '(8월 출석 포함 기준입니다.)',
    ].join('\n');

    return res.json({
      version: '2.0',
      template: {
        outputs: [
          {
            simpleText: { text: msg },
          },
        ],
      },
    });
  } catch (err) {
    console.error('출석 조회 중 오류:', err);

    const msg = [
      '출석 조회 중 내부 오류가 발생했습니다.',
      '잠시 후 다시 시도해 주세요.',
      '(지속되면 운영진에게 문의해주세요.)',
    ].join('\n');

    return res.json({
      version: '2.0',
      template: {
        outputs: [
          {
            simpleText: { text: msg },
          },
        ],
      },
    });
  }
});

// ======================================
// 8. 헬스체크
// ======================================

app.get('/', (req, res) => {
  res.send('Linkus skill server OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
