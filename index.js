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
const AUTH_SHEET_NAME = '18기(전 인원) 명단';
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

// 출석 데이터 범위 (이름 + OUT 합계 + 출결 10개 열 포함)
const ATT_RANGE = `${ATT_SHEET_NAME}!A5:Q`; // 5행부터 데이터

// 날짜 헤더(열 제목) 범위: D~M 열 (10개 날짜)
const ATT_DATE_RANGE = `${ATT_SHEET_NAME}!D3:M3`;

// 출석부 열 인덱스
const COL_ATT_NAME = 2;  // C열: 이름
const COL_OUT_N = 13;    // N열: 아웃카운트(출석)
const COL_OUT_P = 15;    // P열: 8월 출석 포함 아웃카운트

// 출결 상세 데이터 열 범위 (D~M)
const COL_ATT_START = 3;   // D열 index = 3
const COL_ATT_END = 12;    // M열 index = 12

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
// 4. 출석기록 1칸 파싱 → OUT 값 + 설명
// ======================================
//
// 규칙 (D~M 셀 내용 예시)
// △ (병결)          → 0.5 OUT, "예외 (병결)"
// △ (경조사)        → 0.5 OUT, "예외 (경조사)"
// △ (13:19)         → 0.5 OUT, "지각 (13:19)"
// △ (16 : 09 조퇴)  → 0.5 OUT, "조퇴 (16:09)"
// x                 → 1 OUT,   "결석"
// x (15:30 조퇴)    → 1 OUT,   "결석 (조퇴 15:30)"
// x (15:04)         → 1 OUT,   "결석 (15:04)"
//
function parseAttendanceCell(rawValue) {
  if (rawValue === undefined || rawValue === null) {
    return { out: 0, label: '' };
  }

  const textOriginal = String(rawValue).trim();
  if (!textOriginal) {
    return { out: 0, label: '' };
  }

  const text = textOriginal.replace(/\s+/g, ' '); // 공백 정리
  const lower = text.toLowerCase();

  // 정상 출석 (O)
  if (text === 'O' || text === 'o' || text === '○') {
    return { out: 0, label: '출석' };
  }

  // 괄호 안 내용 추출
  const m = text.match(/\(([^)]*)\)/);
  const innerRaw = m ? m[1].trim() : '';
  const inner = innerRaw.replace(/\s+/g, ' '); // 공백 정리

  // △ 계열 (지각/조퇴/병결/경조사) → 0.5 OUT
  if (text.includes('△')) {
    let out = 0.5;
    let label;

    if (inner.includes('병결')) {
      label = '예외 (병결)';
    } else if (inner.includes('경조사')) {
      label = '예외 (경조사)';
    } else if (inner.includes('조퇴')) {
      // 예: "16 : 09 조퇴"
      const timePart = inner.replace('조퇴', '').trim();
      const timeNormalized = timePart.replace(/\s*:\s*/, ':'); // "16 : 09" → "16:09"
      label = timeNormalized
        ? `조퇴 (${timeNormalized})`
        : '조퇴';
    } else if (inner) {
      // 숫자만 있을 때 = 지각 시간 (예: "13:19")
      const timeNormalized = inner.replace(/\s*:\s*/, ':');
      label = `지각 (${timeNormalized})`;
    } else {
      label = '지각/조퇴';
    }

    return { out, label };
  }

  // x / X 계열 = 결석 (스태프 미인정 포함)
  if (lower.startsWith('x')) {
    let out = 1;
    let label = '결석';

    if (inner) {
      if (inner.includes('조퇴')) {
        // 예: "15:30 조퇴"
        const timePart = inner.replace('조퇴', '').trim();
        const timeNormalized = timePart.replace(/\s*:\s*/, ':');
        label = timeNormalized
          ? `결석 (조퇴 ${timeNormalized})`
          : '결석 (조퇴)';
      } else {
        label = `결석 (${inner})`;
      }
    }

    return { out, label };
  }

  // 그 외 값은 0 OUT으로 취급
  return { out: 0, label: text };
}

// ======================================
// 5. 출석부: 이름으로 아웃카운트 + 상세내역 찾기
// ======================================

async function findAttendanceByName(name) {
  const sheets = createSheetsClient();

  // 날짜 헤더 + 데이터 행을 동시에 가져오기
  const [headerRes, dataRes] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId: ATT_SPREADSHEET_ID,
      range: ATT_DATE_RANGE, // D3:M3
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId: ATT_SPREADSHEET_ID,
      range: ATT_RANGE, // A5:Q
    }),
  ]);

  const dateRow = (headerRes.data.values && headerRes.data.values[0]) || [];
  const rows = dataRes.data.values || [];
  if (!rows.length) return null;

  const targetName = (name || '').trim();

  const parseOutNumber = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const num = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
    return Number.isNaN(num) ? null : num;
  };

  for (const row of rows) {
    const rowName = (row[COL_ATT_NAME] || '').trim();
    if (!rowName) continue;

    if (rowName === targetName) {
      const outN = parseOutNumber(row[COL_OUT_N]);
      const outP = parseOutNumber(row[COL_OUT_P]);
      const totalOut = outP !== null ? outP : outN;

      // 상세 내역: D~M 열에서 OUT > 0인 날만 추출
      const details = [];

      for (let col = COL_ATT_START; col <= COL_ATT_END; col++) {
        const cell = row[col];
        const { out, label } = parseAttendanceCell(cell);

        if (!out || out <= 0) continue; // OUT 없는 날은 스킵

        const headerIdx = col - COL_ATT_START; // 0~9
        const headerTextRaw = dateRow[headerIdx] || '';
        const headerText = String(headerTextRaw).trim();

        // 날짜 표시: 시트 헤더가 비어있으면 "제n회차"로 대체
        const dateLabel = headerText || `제${headerIdx + 1}회차`;

        details.push({
          date: dateLabel,
          out,
          label,
        });
      }

      return {
        name: rowName,
        totalOut,
        details,
      };
    }
  }

  return null;
}

// ======================================
// 6. 간단 세션: 마지막 본인인증 결과
// ======================================

// key: kakao user id, value: { name, role, phone4 }
const lastAuthByUserId = new Map();

// ======================================
// 7. Kakao 스킬 - 본인인증 (/kakao)
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
// 8. Kakao 스킬 - 출석조회 (/attendance)
// ======================================

app.post('/attendance', async (req, res) => {
  const body = req.body || {};
  const userRequest = body.userRequest || {};
  const user = userRequest.user || {};
  const kakaoUserId = user.id || null;

  // 1) 사용자 정보 없음
  if (!kakaoUserId) {
    const msg = [
      '사용자 정보를 확인할 수 없습니다.',
      '다시 시도해 주세요.'
    ].join('\n');

    return res.json({
      version: '2.0',
      template: {
        outputs: [
          {
            simpleText: { text: msg }
          }
        ]
      }
    });
  }

  // 2) 본인인증 세션 없음
  const session = lastAuthByUserId.get(kakaoUserId);

  if (!session || !session.name) {
    const msg = [
      '먼저 본인인증이 필요합니다.',
      '출석 현황 메뉴에서 [본인확인]을 다시 진행해 주세요.'
    ].join('\n');

    return res.json({
      version: '2.0',
      template: {
        outputs: [
          {
            simpleText: { text: msg }
          }
        ]
      }
    });
  }

  // 3) 출석 정보 조회
  try {
    const attendance = await findAttendanceByName(session.name);

    // 출석 데이터 없음 or 총 OUT 값 없음
    if (!attendance || attendance.totalOut === null) {
      const msg = [
        session.name + '님의 출석 정보를 찾지 못했습니다.',
        '운영진에게 출석부 등록 여부를 확인해 주세요.'
      ].join('\n');

      return res.json({
        version: '2.0',
        template: {
          outputs: [
            {
              simpleText: { text: msg }
            }
          ]
        }
      });
    }

    // 4) 메시지 구성
    const lines = [];
    lines.push(session.name + '님의 출석 현황입니다.');
    lines.push('');
    lines.push('총 아웃카운트: ' + attendance.totalOut + ' OUT');

    // 상세 내역 (OUT 발생일만)
    if (attendance.details && attendance.details.length > 0) {
      lines.push('');
      lines.push('📌 상세 내역 (OUT 발생일)');
      attendance.details.forEach(function (d) {
        lines.push('- ' + d.date + ': ' + d.label + ' → ' + d.out + ' OUT');
      });
    }

    const msg = lines.join('\n');

    return res.json({
      version: '2.0',
      template: {
        outputs: [
          {
            simpleText: { text: msg }
          }
        ]
      }
    });
  } catch (err) {
    console.error('출석 조회 중 오류:', err);

    const msg = [
      '출석 조회 중 내부 오류가 발생했습니다.',
      '잠시 후 다시 시도해 주세요.',
      '(지속되면 운영진에게 문의해주세요.)'
    ].join('\n');

    return res.json({
      version: '2.0',
      template: {
        outputs: [
          {
            simpleText: { text: msg }
          }
        ]
      }
    });
  }
});

// ======================================
// 9. 헬스체크
// ======================================

app.get('/', (req, res) => {
  res.send('Linkus skill server OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
