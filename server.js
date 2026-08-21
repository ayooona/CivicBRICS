import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = './requests.json';
const DEMO_FILE = './demo-hotspots.json';
const USERS_FILE = './users.json';
const EMPLOYEE_FILE = './employee.json';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

app.use(express.static('public'));
app.use(express.json());

// Helper methods for reading and saving JSON files
function readDatabaseFromFile() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2));
      return [];
    }
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8') || '[]');
  } catch (err) {
    return [];
  }
}

function saveDatabaseToFile(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error saving database:', err);
  }
}

function readDemoDataFromFile() {
  try {
    if (!fs.existsSync(DEMO_FILE)) return [];
    return JSON.parse(fs.readFileSync(DEMO_FILE, 'utf-8') || '[]');
  } catch (err) {
    return [];
  }
}

function readUsersFromFile() {
  try {
    if (!fs.existsSync(USERS_FILE)) {
      fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
      return [];
    }
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8') || '[]');
  } catch (err) {
    return [];
  }
}

function saveUsersToFile(data) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error saving users:', err);
  }
}

function readEmployeesFromFile() {
  try {
    if (!fs.existsSync(EMPLOYEE_FILE)) {
      fs.writeFileSync(EMPLOYEE_FILE, JSON.stringify([], null, 2));
      return [];
    }
    return JSON.parse(fs.readFileSync(EMPLOYEE_FILE, 'utf-8') || '[]');
  } catch (err) {
    return [];
  }
}

// -------------------------------------------------------------
// AUTH 1: Citizen Registration
// -------------------------------------------------------------
app.post('/api/register', (req, res) => {
  try {
    const { name, emailOrPhone, country, password, role } = req.body;

    if (role === 'Government Employee') {
      return res.status(403).json({
        error: 'Government accounts are pre-provisioned in employee.json and cannot be created via public registration.'
      });
    }

    if (!name || !emailOrPhone || !password) {
      return res.status(400).json({ error: 'All required fields must be filled.' });
    }

    const users = readUsersFromFile();
    const cleanContact = emailOrPhone.trim().toLowerCase();

    if (users.some(u => (u.emailOrPhone || '').toLowerCase() === cleanContact)) {
      return res.status(400).json({ error: 'An account with this Email/Phone already exists. Please log in.' });
    }

    const newUser = {
      id: 'cit-' + Date.now(),
      name: name.trim(),
      emailOrPhone: cleanContact,
      country: country || 'India',
      password: password.trim(),
      role: 'Citizen',
      registeredAt: new Date().toISOString()
    };

    users.push(newUser);
    saveUsersToFile(users);

    res.json({ success: true, user: newUser });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create citizen account.' });
  }
});

// -------------------------------------------------------------
// AUTH 2: Unified Login
// -------------------------------------------------------------
app.post('/api/login', (req, res) => {
  try {
    const { emailOrPhone, password, role } = req.body;

    if (!emailOrPhone || !password) {
      return res.status(400).json({ error: 'Please enter both Email/Phone and Password.' });
    }

    const cleanContact = emailOrPhone.trim().toLowerCase();
    const cleanPassword = password.trim();
    const isGovt = role === 'Government Employee';
    const accountList = isGovt ? readEmployeesFromFile() : readUsersFromFile();

    const matchedUser = accountList.find(u => {
      const dbContact = (u.emailOrPhone || '').trim().toLowerCase();
      const dbPassword = (u.password || '').trim();
      return dbContact === cleanContact && dbPassword === cleanPassword;
    });

    if (!matchedUser) {
      return res.status(401).json({
        error: isGovt
          ? 'Invalid government credentials. Record not found in employee.json.'
          : 'Invalid citizen credentials. Record not found in users.json.'
      });
    }

    res.json({
      success: true,
      user: {
        ...matchedUser,
        role: matchedUser.role || (isGovt ? 'Government Employee' : 'Citizen')
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Authentication service failure.' });
  }
});

// -------------------------------------------------------------
// ENDPOINT 3: Issue Submission + AI Officer Allocation
// -------------------------------------------------------------
app.post('/api/submit-request', async (req, res) => {
  try {
    const { country, state, address, rawText, citizenName, citizenContact } = req.body;

    if (!rawText || !rawText.trim()) {
      return res.status(400).json({ error: 'Request description cannot be empty.' });
    }

    const availableEmployees = readEmployeesFromFile();
    const employeeDirectorySummary = availableEmployees.map(e => ({
      employeeId: e.employeeId,
      name: e.name,
      designation: e.designation,
      department: e.department,
      sector: e.sector,
      country: e.country,
      state: e.state,
      assignedDistrict: e.assignedDistrict
    }));

    const prompt = `
You are the Multilateral Public Policy and Infrastructure AI Engine for BRICS nations.

Analyze this citizen infrastructure issue and assign it to the single best-matching Government Officer from the directory.

CITIZEN REPORT:
- Country: ${country || 'Unspecified'}
- State/Province: ${state || 'Unspecified'}
- Specific Address/Landmark: "${address || 'Unspecified'}"
- Citizen Description: "${rawText}"

OFFICIAL GOVERNMENT EMPLOYEE DIRECTORY:
${JSON.stringify(employeeDirectorySummary, null, 2)}

TASKS:
1. Identify the language of the citizen input.
2. Translate the complaint accurately into clear English.
3. Classify into ONE Infrastructure Sector (Transportation & Roads, Water & Sanitation, Energy & Power, Healthcare Infrastructure, Agriculture & Irrigation, Education Infrastructure, Telecommunications & Digital, Waste & Municipal Environment, Public Safety & Housing).
4. Assign an Urgency Score from 1 to 10.
5. Provide a 1-sentence Policy Action recommendation.
6. ASSIGN TO BEST OFFICER:
   - Match by Sector, Country, State, and District/Address proximity.
   - If an exact officer exists in the directory matching the sector and region, select their employeeId.
   - If no direct match exists, return null for matchedEmployeeId and provide a recommended jurisdictional authority title in "fallbackOfficerTitle".

Respond strictly in raw JSON with this exact schema and NO markdown backticks:
{
  "detectedLanguage": "Name of language",
  "translatedText": "Full translation into English",
  "summary": "1-sentence English summary",
  "sector": "Sector Name",
  "urgencyScore": 8,
  "affectedScale": "Local Village | District | Regional Corridor",
  "recommendation": "Policy action recommendation",
  "matchedEmployeeId": "employeeId from directory or null",
  "assignmentReason": "Why this officer is best suited for this location and issue"
}
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt,
      config: { responseMimeType: 'application/json' }
    });

    let rawResult = response.text.trim();
    if (rawResult.startsWith('```json')) {
      rawResult = rawResult.replace(/^```json/, '').replace(/```$/, '').trim();
    } else if (rawResult.startsWith('```')) {
      rawResult = rawResult.replace(/^```/, '').replace(/```$/, '').trim();
    }

    const parsed = JSON.parse(rawResult);

    // Look up the full officer details if Gemini matched an employeeId
    let assignedOfficer = null;
    if (parsed.matchedEmployeeId) {
      const foundEmp = availableEmployees.find(e => e.employeeId === parsed.matchedEmployeeId);
      if (foundEmp) {
        assignedOfficer = {
          name: foundEmp.name,
          designation: foundEmp.designation,
          department: foundEmp.department,
          employeeId: foundEmp.employeeId,
          emailOrPhone: foundEmp.emailOrPhone,
          assignedDistrict: foundEmp.assignedDistrict,
          assignmentReason: parsed.assignmentReason
        };
      }
    }

    // Fallback if no specific officer is in employee.json
    if (!assignedOfficer) {
      assignedOfficer = {
        name: `Regional ${parsed.sector || 'Public Works'} Officer`,
        designation: 'Jurisdictional Executive Officer',
        department: `${state || country} Municipal Infrastructure Authority`,
        employeeId: `GEN-${(state || country).substring(0, 3).toUpperCase()}-9900`,
        emailOrPhone: 'nodal.desk@brics.civic.gov',
        assignedDistrict: address || state || country,
        assignmentReason: parsed.assignmentReason || 'Assigned based on regional jurisdiction and sector matching.'
      };
    }

    const newRecord = {
      id: Date.now(),
      citizenName: citizenName || 'Anonymous Citizen',
      citizenContact: citizenContact || 'Not Provided',
      country: country || 'Unspecified',
      state: state || 'Unspecified',
      address: address || 'General Local Area',
      originalText: rawText,
      detectedLanguage: parsed.detectedLanguage || 'Auto-Detected',
      translatedText: parsed.translatedText || parsed.summary || rawText,
      summary: parsed.summary || 'Summary unavailable',
      sector: parsed.sector || 'General Infrastructure',
      urgencyScore: Number(parsed.urgencyScore) || 5,
      affectedScale: parsed.affectedScale || 'Local Village',
      recommendation: parsed.recommendation || 'Under municipal review',
      assignedOfficer: assignedOfficer,
      status: 'Open',
      isDemo: false,
      submittedAt: new Date().toLocaleTimeString()
    };

    const currentList = readDatabaseFromFile();
    currentList.unshift(newRecord);
    saveDatabaseToFile(currentList);

    res.json({ success: true, record: newRecord });
  } catch (error) {
    console.error('Gemini Error:', error);
    res.status(500).json({ error: error.message || 'Failed to process request with AI.' });
  }
});

// -------------------------------------------------------------
// ENDPOINT 4: Mark Issue Resolved
// -------------------------------------------------------------
app.post('/api/resolve-request', (req, res) => {
  try {
    const { id, resolvedBy, employeeId } = req.body;
    const currentList = readDatabaseFromFile();
    const issue = currentList.find(r => String(r.id) === String(id));

    if (!issue) {
      return res.status(404).json({ error: 'Issue not found.' });
    }

    issue.status = 'Resolved';
    issue.resolvedBy = resolvedBy || 'Official Authority';
    issue.resolvedByEmpId = employeeId || '';
    issue.resolvedAt = new Date().toLocaleString();

    saveDatabaseToFile(currentList);
    res.json({ success: true, record: issue });
  } catch (error) {
    res.status(500).json({ error: 'Failed to resolve issue.' });
  }
});

// -------------------------------------------------------------
// ENDPOINT 5: Get All Requests
// -------------------------------------------------------------
app.get('/api/requests', (req, res) => {
  res.json(readDatabaseFromFile());
});

// -------------------------------------------------------------
// ENDPOINT 6: Load Demo Hotspots
// -------------------------------------------------------------
app.post('/api/load-sample-data', (req, res) => {
  const sampleData = readDemoDataFromFile();
  const currentList = readDatabaseFromFile();
  const publicOnly = currentList.filter(item => item.isDemo !== true);
  const mergedList = [...publicOnly, ...sampleData];
  saveDatabaseToFile(mergedList);
  res.json({ success: true, count: mergedList.length });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});