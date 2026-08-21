import express from 'express';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { GoogleGenAI } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: '1mb' }));

// Serve index.html, portal.html, style.css, etc.
// from the same folder as server.js.
app.use(express.static(__dirname));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
/* ============================================================
   MYSQL
   ============================================================ */

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'civicbrics',

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,

  ssl: process.env.DB_SSL === 'true'
    ? { rejectUnauthorized: false }
    : undefined
});

/* ============================================================
   GEMINI
   ============================================================ */

if (!process.env.GEMINI_API_KEY) {
  console.error('ERROR: GEMINI_API_KEY is missing.');
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

/* ============================================================
   IN-MEMORY SESSIONS
   Token is stored only server-side.
   Browser receives the random token.
   ============================================================ */

const sessions = new Map();

const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

function createSession(user) {
  const token = crypto.randomBytes(48).toString('hex');

  sessions.set(token, {
    userId: Number(user.id),
    role: user.role,
    employeeId: user.employee_id || null,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS
  });

  return token;
}

function getSession(req) {
  const header = req.headers.authorization || '';

  if (!header.startsWith('Bearer ')) {
    return null;
  }

  const token = header.slice(7).trim();

  if (!token) {
    return null;
  }

  const session = sessions.get(token);

  if (!session) {
    return null;
  }

  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }

  return {
    ...session,
    token
  };
}

function requireAuth(req, res, next) {
  const session = getSession(req);

  if (!session) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required. Please sign in again.'
    });
  }

  req.session = session;
  next();
}

function requireGovernment(req, res, next) {
  const session = getSession(req);

  if (!session) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required.'
    });
  }

  if (session.role !== 'Government Employee') {
    return res.status(403).json({
      success: false,
      error: 'Government employee access required.'
    });
  }

  req.session = session;
  next();
}

/* ============================================================
   HELPERS
   ============================================================ */

function clean(value, maxLength = 5000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function normalize(value) {
  return clean(value).toLowerCase();
}

function clampUrgency(value) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return 5;
  }

  return Math.max(1, Math.min(10, Math.round(n)));
}

function safeConfidence(value) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return 0.75;
  }

  return Math.max(0, Math.min(1, n));
}

function publicUser(user) {
  return {
    id: user.id,
    publicId: user.public_id,
    name: user.name,
    emailOrPhone: user.email_or_phone,
    country: user.country,
    state: user.state,
    role: user.role,
    accountStatus: user.account_status,

    employeeId: user.employee_id || null,
    designation: user.designation || null,
    department: user.department || null,
    sector: user.sector || null,
    assignedDistrict: user.assigned_district || null,
    jurisdictionScale: user.jurisdiction_scale || null
  };
}

/* Convert MySQL request row into the exact frontend format */
function formatRequest(row) {
  return {
    id: row.id,
    publicId: row.public_id,

    citizenId: row.citizen_id,
    citizenName: row.citizen_name,
    citizenContact: row.citizen_contact,

    country: row.country,
    state: row.state,
    district: row.district,
    city: row.city,
    ward: row.ward,
    address: row.address,

    originalText: row.original_text,
    detectedLanguage: row.detected_language,
    translatedText: row.translated_text,
    summary: row.summary,

    sector: row.sector,
    urgencyScore: Number(row.urgency_score || 0),
    affectedScale: row.affected_scale,
    recommendation: row.recommendation,
    aiConfidence: row.ai_confidence == null
      ? null
      : Number(row.ai_confidence),

    assignmentReason: row.assignment_reason,

    assignedEmployeeId: row.assigned_employee_id,

    status: row.status,

    isDemo: Boolean(row.is_demo),
    isPublic: Boolean(row.is_public),

    submittedAt: row.submitted_at,
    assignedAt: row.assigned_at,

    resolvedByEmployeeId: row.resolved_by_employee_id,
    resolvedBy: row.resolved_by_name,
    resolvedAt: row.resolved_at,
    assignedOfficer: row.assigned_officer_name
    ? {
        name: row.assigned_officer_name,
        designation: row.assigned_officer_designation,
        department: row.assigned_officer_department,
        employeeId: row.assigned_officer_employee_id,
        emailOrPhone: row.assigned_officer_contact,
        assignedDistrict: row.assigned_officer_district,
        assignmentReason: row.assignment_reason
      }
    : null,
  };
}

/* ============================================================
   HEALTH CHECK
   ============================================================ */

app.get('/api/health', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT 1 AS ok');

    res.json({
      success: true,
      database: rows[0]?.ok === 1,
      service: 'CivicBRICS API'
    });
  } catch (error) {
    console.error('Health check error:', error);

    res.status(503).json({
      success: false,
      database: false,
      error: 'Database connection failed.'
    });
  }
});

/* ============================================================
   REGISTER CITIZEN
   ============================================================ */

app.post('/api/register', async (req, res) => {
  try {
    const name = clean(req.body.name, 150);
    const emailOrPhone = clean(req.body.emailOrPhone, 150);
    const country = clean(req.body.country, 100);
    const password = String(req.body.password || '');
    const role = clean(req.body.role, 50);
    const termsAccepted = Boolean(req.body.termsAccepted);

    if (role !== 'Citizen') {
      return res.status(403).json({
        success: false,
        error: 'Government accounts are provisioned by the administration.'
      });
    }

    if (!name || !emailOrPhone || !password) {
      return res.status(400).json({
        success: false,
        error: 'All required fields must be filled.'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must contain at least 6 characters.'
      });
    }

    if (!termsAccepted) {
      return res.status(400).json({
        success: false,
        error: 'You must accept the Terms of Service.'
      });
    }

    const contact = normalize(emailOrPhone);

    const [existing] = await pool.execute(
      `
      SELECT id
      FROM users
      WHERE LOWER(email_or_phone) = ?
      LIMIT 1
      `,
      [contact]
    );

    if (existing.length) {
      return res.status(409).json({
        success: false,
        error: 'An account with this Email/Phone already exists. Please log in.'
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const publicId =
      'cit-' +
      crypto.randomBytes(8).toString('hex');

    const [result] = await pool.execute(
      `
      INSERT INTO users
      (
        public_id,
        name,
        email_or_phone,
        password_hash,
        country,
        role,
        account_status,
        terms_accepted,
        registered_at
      )
      VALUES (?, ?, ?, ?, ?, 'Citizen', 'Active', 1, NOW())
      `,
      [
        publicId,
        name,
        contact,
        passwordHash,
        country || 'India'
      ]
    );

    const [rows] = await pool.execute(
      `
      SELECT *
      FROM users
      WHERE id = ?
      LIMIT 1
      `,
      [result.insertId]
    );

    const user = rows[0];

    const token = createSession(user);

    return res.status(201).json({
      success: true,
      token,
      user: publicUser(user)
    });

  } catch (error) {
    console.error('Registration error:', error);

    return res.status(500).json({
      success: false,
      error: 'Failed to create citizen account.'
    });
  }
});

/* ============================================================
   LOGIN
   ============================================================ */

app.post('/api/login', async (req, res) => {
  try {
    const emailOrPhone = normalize(req.body.emailOrPhone);
    const password = String(req.body.password || '');
    const role = clean(req.body.role, 50);

    if (!emailOrPhone || !password) {
      return res.status(400).json({
        success: false,
        error: 'Please enter both Email/Phone and Password.'
      });
    }

    if (
      role !== 'Citizen' &&
      role !== 'Government Employee'
    ) {
      return res.status(400).json({
        success: false,
        error: 'Invalid account type.'
      });
    }

    let rows;

    if (role === 'Citizen') {

      [rows] = await pool.execute(
        `
        SELECT *
        FROM users
        WHERE LOWER(email_or_phone) = ?
          AND role = 'Citizen'
        LIMIT 1
        `,
        [emailOrPhone]
      );

    } else {

      [rows] = await pool.execute(
        `
        SELECT
          e.*,
          e.id AS employee_db_id
        FROM employees e
        WHERE LOWER(e.email_or_phone) = ?
          AND e.role = 'Government Employee'
        LIMIT 1
        `,
        [emailOrPhone]
      );
    }

    if (!rows.length) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials.'
      });
    }

    const account = rows[0];

    if (
      account.account_status &&
      !['Active', 'Active Verified Official'].includes(
        account.account_status
      )
    ) {
      return res.status(403).json({
        success: false,
        error: 'This account is not active.'
      });
    }

    const passwordHash = account.password_hash;

    if (!passwordHash) {
      return res.status(500).json({
        success: false,
        error: 'Account password configuration is invalid.'
      });
    }

    const validPassword =
      await bcrypt.compare(
        password,
        passwordHash
      );

    if (!validPassword) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials.'
      });
    }

    let user;

    if (role === 'Citizen') {

      user = account;

    } else {

      user = {
        ...account,
        id: account.employee_db_id,
        employee_id: account.employee_id
      };
    }

    const token = createSession(user);

    return res.json({
      success: true,
      token,
      user: publicUser(user)
    });

  } catch (error) {
    console.error('Login error:', error);

    return res.status(500).json({
      success: false,
      error: 'Login failed because of a server error.'
    });
  }
});

/* ============================================================
   CURRENT USER
   ============================================================ */

app.get('/api/me', requireAuth, async (req, res) => {
  try {

    if (req.session.role === 'Citizen') {

      const [rows] = await pool.execute(
        `
        SELECT *
        FROM users
        WHERE id = ?
        LIMIT 1
        `,
        [req.session.userId]
      );

      if (!rows.length) {
        return res.status(401).json({
          success: false,
          error: 'User account no longer exists.'
        });
      }

      return res.json({
        success: true,
        user: publicUser(rows[0])
      });
    }

    const [rows] = await pool.execute(
      `
      SELECT
        e.*,
        e.id AS employee_db_id
      FROM employees e
      WHERE e.id = ?
      LIMIT 1
      `,
      [req.session.userId]
    );

    if (!rows.length) {
      return res.status(401).json({
        success: false,
        error: 'Government account no longer exists.'
      });
    }

    const user = {
      ...rows[0],
      id: rows[0].employee_db_id
    };

    return res.json({
      success: true,
      user: publicUser(user)
    });

  } catch (error) {
    console.error('/api/me error:', error);

    res.status(500).json({
      success: false,
      error: 'Could not load your account.'
    });
  }
});

/* ============================================================
   LOGOUT
   ============================================================ */

app.post('/api/logout', requireAuth, (req, res) => {
  sessions.delete(req.session.token);

  res.json({
    success: true
  });
});

/* ============================================================
   GEMINI ANALYSIS
   ============================================================ */

async function analyzeWithGemini({
  country,
  state,
  address,
  rawText,
  employees
}) {

  const employeeDirectory =
    employees.map(e => ({
      employeeId: e.employee_id,
      name: e.name,
      designation: e.designation,
      department: e.department,
      sector: e.sector,
      country: e.country,
      state: e.state,
      jurisdictionScale: e.jurisdiction_scale,
      assignedDistrict: e.assigned_district
    }));

  const prompt = `
You are CivicBRICS, an AI system for civic infrastructure prioritization.

Analyze this citizen infrastructure report.

Country:
${country}

State/Province:
${state}

Address/Landmark:
${address}

Citizen report:
${rawText}

AVAILABLE GOVERNMENT OFFICERS:
${JSON.stringify(employeeDirectory, null, 2)}

Tasks:

1. Detect the original language.
2. Translate the complete report into English.
3. Produce a one-sentence English summary.
4. Classify it into the best infrastructure sector.
5. Assign an urgency score from 1 to 10.
6. Estimate affected scale.
7. Provide one concise policy action recommendation.
8. Match the BEST government officer based on:
   - sector
   - country
   - state
   - district/address
   - jurisdiction
9. If no officer is a reasonable match, return null for matchedEmployeeId and provide fallbackOfficerTitle.
10. Give a confidence score between 0 and 1.

Allowed affectedScale examples:
Local Community
Local Village
Ward
City
District
Regional
Regional Corridor

Return ONLY valid JSON:

{
  "detectedLanguage": "",
  "translatedText": "",
  "summary": "",
  "sector": "",
  "urgencyScore": 1,
  "affectedScale": "",
  "recommendation": "",
  "matchedEmployeeId": null,
  "assignmentReason": "",
  "confidence": 0.0,
  "fallbackOfficerTitle": ""
}
`;

  const response =
    await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json'
      }
    });

  let text =
    String(response.text || '').trim();

  text =
    text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

  return JSON.parse(text);
}

/* ============================================================
   SUBMIT REQUEST
   ============================================================ */

app.post(
  '/api/submit-request',
  requireAuth,
  async (req, res) => {

    try {

      if (req.session.role !== 'Citizen') {
        return res.status(403).json({
          success: false,
          error: 'Only citizens can submit infrastructure requests.'
        });
      }

      const country =
        clean(req.body.country, 100);

      const state =
        clean(req.body.state, 150);

      const address =
        clean(req.body.address, 500);

      const rawText =
        clean(req.body.rawText, 10000);

      if (!country || !state || !address || !rawText) {
        return res.status(400).json({
          success: false,
          error: 'Country, State, Address and Issue Description are required.'
        });
      }

      /* Never trust citizen name/contact from browser */
      const [citizenRows] =
        await pool.execute(
          `
          SELECT *
          FROM users
          WHERE id = ?
            AND role = 'Citizen'
          LIMIT 1
          `,
          [req.session.userId]
        );

      if (!citizenRows.length) {
        return res.status(401).json({
          success: false,
          error: 'Citizen account could not be verified.'
        });
      }

      const citizen =
        citizenRows[0];

      /* Load active officers */
      const [employees] =
        await pool.execute(
          `
          SELECT *
          FROM employees
          WHERE role = 'Government Employee'
            AND account_status IN
              ('Active', 'Active Verified Official')
          `
        );

      const startedAt =
        Date.now();

      const parsed =
        await analyzeWithGemini({
          country,
          state,
          address,
          rawText,
          employees
        });

      const processingTime =
        Date.now() - startedAt;

      const urgencyScore =
        clampUrgency(
          parsed.urgencyScore
        );

      const confidence =
        safeConfidence(
          parsed.confidence
        );

      let assignedEmployee = null;

      if (parsed.matchedEmployeeId) {

        assignedEmployee =
          employees.find(
            e =>
              String(e.employee_id) ===
              String(parsed.matchedEmployeeId)
          );
      }

      let assignedEmployeeDbId =
        null;

      if (assignedEmployee) {
        assignedEmployeeDbId =
          assignedEmployee.id;
      }

      const connection =
        await pool.getConnection();

      try {

        await connection.beginTransaction();

        const publicId =
          'req-' +
          crypto.randomBytes(8).toString('hex');

        const [insertResult] =
          await connection.execute(
            `
            INSERT INTO requests
            (
              public_id,
              citizen_id,
              citizen_name,
              citizen_contact,
              country,
              state,
              address,
              original_text,
              detected_language,
              translated_text,
              summary,
              sector,
              urgency_score,
              affected_scale,
              recommendation,
              ai_confidence,
              assignment_reason,
              assigned_employee_id,
              status,
              is_demo,
              is_public,
              submitted_at,
              assigned_at
            )
            VALUES
            (
              ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, 'Assigned',
              0, 1, NOW(), ?
            )
            `,
            [
              publicId,
              citizen.id,
              citizen.name,
              citizen.email_or_phone,
              country,
              state,
              address,
              rawText,
              parsed.detectedLanguage ||
                'Auto-Detected',
              parsed.translatedText ||
                rawText,
              parsed.summary ||
                'Infrastructure issue submitted for review.',
              parsed.sector ||
                'General Infrastructure',
              urgencyScore,
              parsed.affectedScale ||
                'Local Community',
              parsed.recommendation ||
                'Under municipal review.',
              confidence,
              parsed.assignmentReason ||
                'Routed based on sector and jurisdiction.',
              assignedEmployeeDbId,
              assignedEmployeeDbId
                ? new Date()
                : null
            ]
          );

        const requestId =
          insertResult.insertId;

        /* AI analysis history */
        await connection.execute(
          `
          INSERT INTO request_ai_analysis
          (
            request_id,
            model_name,
            detected_language,
            translated_text,
            summary,
            sector,
            urgency_score,
            affected_scale,
            recommendation,
            matched_employee_id,
            assignment_reason,
            confidence_score,
            prompt_version,
            processing_status,
            processing_time_ms
          )
          VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Success', ?)
          `,
          [
            requestId,
            'gemini-3.6-flash',
            parsed.detectedLanguage ||
              'Auto-Detected',
            parsed.translatedText ||
              rawText,
            parsed.summary || '',
            parsed.sector ||
              'General Infrastructure',
            urgencyScore,
            parsed.affectedScale ||
              'Local Community',
            parsed.recommendation ||
              'Under municipal review.',
            assignedEmployeeDbId,
            parsed.assignmentReason || '',
            confidence,
            'v1.1',
            processingTime
          ]
        );

        /* Audit */
        await connection.execute(
          `
          INSERT INTO audit_logs
          (
            request_id,
            actor_type,
            actor_user_id,
            action,
            new_status,
            details
          )
          VALUES
          (?, 'Citizen', ?, 'REQUEST_CREATED', 'Assigned', ?)
          `,
          [
            requestId,
            citizen.id,
            'Citizen request created and analyzed by Gemini.'
          ]
        );

        await connection.execute(
          `
          INSERT INTO audit_logs
          (
            request_id,
            actor_type,
            actor_employee_id,
            action,
            new_status,
            details
          )
          VALUES
          (?, 'AI', ?, 'AI_ANALYZED', 'Assigned', ?)
          `,
          [
            requestId,
            assignedEmployeeDbId,
            parsed.assignmentReason ||
              'Gemini classified and routed the request.'
          ]
        );

        await connection.commit();

        const [rows] =
          await connection.execute(
            `
            SELECT *
            FROM requests
            WHERE id = ?
            LIMIT 1
            `,
            [requestId]
          );

        const record =
          formatRequest(rows[0]);

        record.assignedOfficer =
          assignedEmployee
            ? {
                name: assignedEmployee.name,
                designation:
                  assignedEmployee.designation,
                department:
                  assignedEmployee.department,
                employeeId:
                  assignedEmployee.employee_id,
                emailOrPhone:
                  assignedEmployee.email_or_phone,
                assignedDistrict:
                  assignedEmployee.assigned_district,
                assignmentReason:
                  parsed.assignmentReason
              }
            : null;

        record.fallbackOfficerTitle =
          assignedEmployee
            ? null
            : (
                parsed.fallbackOfficerTitle ||
                `Regional ${parsed.sector || 'Public Works'} Authority`
              );

        return res.status(201).json({
          success: true,
          record
        });

      } catch (error) {

        await connection.rollback();
        throw error;

      } finally {

        connection.release();
      }

    } catch (error) {

      console.error(
        'Submit request error:',
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error.message ||
          'Failed to process request with AI.'
      });
    }
  }
);

/* ============================================================
   GET REQUESTS
   ============================================================ */

app.get(
  '/api/requests',
  requireAuth,
  async (req, res) => {

    try {

      let rows;

      if (req.session.role === 'Government Employee') {

        /*
         * Government employees only receive:
         * - issues assigned to them
         * - issues within their jurisdiction
         */

        const [employeeRows] =
          await pool.execute(
            `
            SELECT *
            FROM employees
            WHERE id = ?
            LIMIT 1
            `,
            [req.session.userId]
          );

        if (!employeeRows.length) {
          return res.status(403).json({
            success: false,
            error: 'Government employee record not found.'
          });
        }

        const employee =
          employeeRows[0];

        [rows] =
          await pool.execute(
            `
            SELECT *
            FROM requests
            WHERE is_public = 1
              AND
              (
                assigned_employee_id = ?

                OR
                (
                  LOWER(country) =
                    LOWER(?)

                  AND LOWER(state) =
                    LOWER(?)

                  AND LOWER(sector) =
                    LOWER(?)
                )
              )
            ORDER BY urgency_score DESC, submitted_at DESC
            `,
            [
              employee.id,
              employee.country,
              employee.state,
              employee.sector
            ]
          );

      } else {

        /*
         * Citizens can see public requests.
         * Their own submissions are included naturally.
         */

        [rows] =
          await pool.execute(
            `
            SELECT
              r.*,
          
              e.name AS assigned_officer_name,
              e.designation AS assigned_officer_designation,
              e.department AS assigned_officer_department,
              e.employee_id AS assigned_officer_employee_id,
              e.email_or_phone AS assigned_officer_contact,
              e.assigned_district AS assigned_officer_district
          
            FROM requests r
          
            LEFT JOIN employees e
              ON e.id = r.assigned_employee_id
          
            WHERE r.is_public = 1
          
            ORDER BY
              r.urgency_score DESC,
              r.submitted_at DESC
            `
          );
      }

      res.json(
        rows.map(formatRequest)
      );

    } catch (error) {

      console.error(
        'Requests error:',
        error
      );

      res.status(500).json({
        success: false,
        error: 'Failed to load requests.'
      });
    }
  }
);

/* ============================================================
   RESOLVE REQUEST
   ============================================================ */

app.post(
  '/api/resolve-request',
  requireGovernment,
  async (req, res) => {

    try {

      const issueId =
        Number(req.body.id);

      if (!Number.isInteger(issueId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request ID.'
        });
      }

      const [employeeRows] =
        await pool.execute(
          `
          SELECT *
          FROM employees
          WHERE id = ?
          LIMIT 1
          `,
          [req.session.userId]
        );

      if (!employeeRows.length) {
        return res.status(403).json({
          success: false,
          error: 'Government employee record not found.'
        });
      }

      const employee =
        employeeRows[0];

      const [requestRows] =
        await pool.execute(
          `
          SELECT *
          FROM requests
          WHERE id = ?
          LIMIT 1
          `,
          [issueId]
        );

      if (!requestRows.length) {
        return res.status(404).json({
          success: false,
          error: 'Issue not found.'
        });
      }

      const issue =
        requestRows[0];

      if (issue.status === 'Resolved') {
        return res.status(400).json({
          success: false,
          error: 'This issue has already been resolved.'
        });
      }

      /*
       * IMPORTANT:
       * Do NOT trust employeeId/resolvedBy from browser.
       *
       * The authenticated server-side session determines
       * who is performing the action.
       */

      const isAssigned =
        Number(issue.assigned_employee_id) ===
        Number(employee.id);

      const sameCountry =
        normalize(issue.country) ===
        normalize(employee.country);

      const sameState =
        normalize(issue.state) ===
        normalize(employee.state);

      const sameSector =
        normalize(issue.sector) ===
        normalize(employee.sector);

      if (
        !isAssigned &&
        !(
          sameCountry &&
          sameState &&
          sameSector
        )
      ) {
        return res.status(403).json({
          success: false,
          error: 'You are not authorized to resolve this issue.'
        });
      }

      const connection =
        await pool.getConnection();

      try {

        await connection.beginTransaction();

        await connection.execute(
          `
          UPDATE requests
          SET
            status = 'Resolved',
            resolved_by_employee_id = ?,
            resolved_by_name = ?,
            resolved_at = NOW()
          WHERE id = ?
          `,
          [
            employee.id,
            employee.name,
            issueId
          ]
        );

        await connection.execute(
          `
          INSERT INTO audit_logs
          (
            request_id,
            actor_type,
            actor_employee_id,
            action,
            old_status,
            new_status,
            details
          )
          VALUES
          (
            ?,
            'Government Employee',
            ?,
            'REQUEST_RESOLVED',
            ?,
            'Resolved',
            ?
          )
          `,
          [
            issueId,
            employee.id,
            issue.status,
            `Issue resolved by ${employee.name} (${employee.employee_id}).`
          ]
        );

        await connection.commit();

      } catch (error) {

        await connection.rollback();
        throw error;

      } finally {

        connection.release();
      }

      const [updatedRows] =
        await pool.execute(
          `
          SELECT *
          FROM requests
          WHERE id = ?
          LIMIT 1
          `,
          [issueId]
        );

      res.json({
        success: true,
        record:
          formatRequest(updatedRows[0])
      });

    } catch (error) {

      console.error(
        'Resolve request error:',
        error
      );

      res.status(500).json({
        success: false,
        error: 'Failed to resolve issue.'
      });
    }
  }
);

/* ============================================================
   DEMO DATA
   ============================================================ */

app.post(
  '/api/load-sample-data',
  requireAuth,
  async (req, res) => {

    /*
     * Keep this endpoint for the hackathon.
     * It is protected now.
     *
     * It does NOT write fake JSON data.
     * Your sample SQL data should already exist in MySQL.
     */

    try {

      const [rows] =
        await pool.execute(
          `
          SELECT COUNT(*) AS total
          FROM requests
          WHERE is_demo = 1
          `
        );

      res.json({
        success: true,
        count: Number(rows[0].total)
      });

    } catch (error) {

      console.error(
        'Demo data error:',
        error
      );

      res.status(500).json({
        success: false,
        error: 'Could not load demo data.'
      });
    }
  }
);

/* ============================================================
   CLEAN EXPIRED SESSIONS
   ============================================================ */

setInterval(() => {

  const now = Date.now();

  for (const [
    token,
    session
  ] of sessions.entries()) {

    if (now > session.expiresAt) {
      sessions.delete(token);
    }
  }

}, 1000 * 60 * 30);

/* ============================================================
   START
   ============================================================ */

async function startServer() {

  try {

    const connection =
      await pool.getConnection();

    await connection.ping();
    connection.release();

    console.log('MySQL connection successful.');

    app.listen(
      PORT,
      () => {
        console.log(
          `CivicBRICS running on port ${PORT}`
        );
      }
    );

  } catch (error) {

    console.error(
      'Could not connect to MySQL:',
      error
    );

    process.exit(1);
  }
}

startServer();