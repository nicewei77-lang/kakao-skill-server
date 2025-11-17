const express = require('express');
const { google } = require('googleapis');

const app = express();
app.use(express.json());

// =========================
// Google Sheets 설정
// =========================

// 실제 시트 ID
const SPREADSHEET_ID = '1F_pq-dE_oAi_nJRThSjP5-QA-c8mmzJ5hA5mSbJXH60';

// 시트 이름 + 데이터 범위
// (1~3행: 헤더, 4행부터 데이터 / A~S열까지 사용)
const SHEET_NAME = '18기(전 인원) 명단';
const MEMBER_RANGE = `${SHEET_NAME}!A4:S`;

// 열 인덱스 (0부터 시작, A=0, B=1, ...)
// ─ 스태프 영역 ─
const COL_STAFF_NAME  = 2;  // C열: 스태프 이름
const COL_STAFF_TEAM  = 4;  // E열: 스태프 직무팀
const COL_STAFF_UNIV  = 6;  // G열: 스태프 대학교
const COL_STAFF_PHONE = 8;  // I열: 스태프 연락처

// ─ 멤버 영역 ─
const COL_MEMBER_NAME  = 11; // L열: 멤버 이름
const COL_MEMBER_TEAM  = 13; // N열: 멤버 직무팀
const COL_MEMBER_UNIV  = 15; // P열: 멤버 대학교
const COL_MEMBER_PHONE = 17; // R열: 멤버 전화번호

// 환경변수에 넣어둔 서비스 계정 JSON 사용
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

// 이름 + 전화번호 뒤 4자리로 스태프/멤버 찾기
async function findPersonByNameAndPhone4(name, phone4) {
  const sheets = createSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: MEMBER_RANGE,
  });

  const rows = res.data.values || [];
  if (!rows.length) return null;

  const targetName = (name || '').trim();
  const targetPhone4 = (phone4 || '').trim();

  for (const row of rows) {
    // 공통: 스태프/멤버 전화번호에서 숫자만 추출해서 마지막 4자리 비교
    const staffPhone = (row[COL_STAFF_PHONE] || '').toString();
    const staffDigits = staffPhone.replace(/[^0-9]/g, '');
    const staffLast4 = staffDigits.slice(-4);

    const memberPhone = (row[COL_MEMBER_PHONE] || '').toString();
    const memberDigits = memberPhone.replace(/[^0-9]/g, '');
    const memberLast4 = memberDigits.slice(-4);

    // 1) 멤버 쪽 먼저 체크
    const memberName = (row[COL_MEMBER_NAME] || '').trim();
    if (memberName && memberDigits && memberLast4 === targetPhone4 && memberName === targetName) {
      return {
        role: '멤버',
        name: memberName,
        phone4: memberLast4,
        team: row[COL_MEMBER_TEAM] || '',
        univ: row[COL_MEMBER_UNIV] || '',
        raw: row,
      };
    }

    // 2) 스태프 쪽 체크
    const staffName = (row[COL_STAFF_NAME] || '').trim();
    if (staffName && staffDigits && staffLast4 === targetPhone4 && staffName === targetName) {
      return {
        role: '스태프',
        name: staffName,
        phone4: staffLast4,
        team: row[COL_STAFF_TEAM] || '',
        univ: row[COL_STAFF_UNIV] || '',
        raw: row,
      };
    }
  }

  // 끝까지 못 찾으면 null
  return null;
}

// =========================
// Kakao 스킬 엔드포인트
// =========================

app.post('/kakao', async (req, res) => {
  const body = req.body || {};
  const action = body.action || {};
  const params = action.params || {};

  const userName = params.user_name || '';
  const userPhone4 = params.user_phone4 || '';

  console.log('인증 요청 - 이름:', userName, '전화 뒤 4자리:', userPhone4);

  // 기본 방어 로직
  if (!userName || !userPhone4) {
    return res.json({
      version: '2.0',
      template: {
        outputs: [
          {
            simpleText: {
              text:
                '이름과 전화번호 뒤 4자리를 모두 입력해야 본인인증이 가능합니다.\n' +
                '다시 시도해주세요.',
            },
          },
        ],
      },
    });
  }

  try {
    const person = await findPersonByNameAndPhone4(userName, userPhone4);

    if (!person) {
      // 시트에서 못 찾은 경우
      return res.json({
        version: '2.0',
        template: {
          outputs: [
            {
              simpleText: {
                text:
                  '입력하신 정보와 일치하는 인원을 찾지 못했습니다.\n' +
                  '이름과 전화번호 뒤 4자리를 다시 한 번 확인해주세요.\n' +
                  '(그래도 안 되면 운영진에게 문의해주세요.)',
              },
            },
          ],
        },
      });
    }

    // 인증 성공한 경우
    const lines = [
      `${person.name}님, 본인인증이 완료되었습니다 ✅`,
      `• 구분: ${person.role}`,           // 스태프 / 멤버
      person.team ? `• 직무팀: ${person.team}` : '',
      person.univ ? `• 대학교: ${person.univ}` : '',
      '',
      '이제 출석 현황/점수 조회 기능을 이용하실 수 있습니다.',
    ].filter(Boolean);

    return res.json({
      version: '2.0',
      template: {
        outputs: [
          {
            simpleText: {
              text: lines.join('\n'),
            },
          },
        ],
        // 이후에 quickReplies로 "출석 현황 보기" 버튼도 여기에 추가하면 됨
      },
    });
  } catch (err) {
    console.error('본인인증 처리 중 오류:', err);

    return res.json({
      version: '2.0',
      template: {
        outputs: [
          {
            simpleText: {
              text:
                '본인인증 처리 중 내부 오류가 발생했습니다.\n' +
                '잠시 후 다시 시도해 주세요.\n' +
                '(지속되면 운영진에게 문의해주세요.)',
            },
          },
        ],
      },
    });
  }
});

// 헬스체크용 루트 엔드포인트
app.get('/', (req, res) => {
  res.send('Linkus skill server OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
