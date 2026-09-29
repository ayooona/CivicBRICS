<div align="center">

<img src="./assets/team-logo.png.jpg" alt="Team OverClocked Logo" width="140">

# 🏛️ CivicBRICS

### Multilateral Digital Public Good for Community Infrastructure Prioritization

**AI-powered platform connecting citizen infrastructure reports with policymakers.**

[🌐 Live Demo](https://civicbrics.onrender.com/index.html) • [📂 Repository](https://github.com/Shivam-2708/CivicBRICS)

**Built by Team OverClocked**

</div>

---

## 📖 Overview

**CivicBRICS** is a full-stack **Digital Public Infrastructure (DPI)** platform designed to bridge the gap between citizens and policymakers across all BRICS+ governments.

Citizens can report urgent infrastructure issues such as:

- 💧 Water scarcity
- ⚡ Power outages
- 🚌 Transit failures
- 🏥 Healthcare gaps

Reports can be submitted in **native and regional languages**, while a **Google Gemini-powered NLP pipeline** standardizes, categorizes, and assesses the urgency of each submission.

The processed information is then presented through a **Policymaker Dashboard**, helping officials understand and prioritize infrastructure needs.

---

## 🎯 Problem

Public infrastructure grievances are often reported through fragmented, language-dependent and non-standardized channels.

This can lead to:

- Delayed responses
- Inefficient resource allocation
- Language barriers
- Lack of transparent prioritization

**CivicBRICS** provides an AI-assisted layer between citizens and policymakers to make civic problems easier to understand and prioritize.

---

## 💡 How It Works

<table>
  <tr>
    <td width="33%" align="center">
      <h3>1️⃣ Ingestion</h3>
      <p>Citizens log complaints via the <b>Web Portal</b> in any regional or native language.</p>
    </td>
    <td width="33%" align="center">
      <h3>2️⃣ Processing</h3>
      <p><b>Express.js & MySQL</b> pass raw data to <b>Google Gemini</b> for NLP, categorization, and urgency scoring.</p>
    </td>
    <td width="33%" align="center">
      <h3>3️⃣ Resolution</h3>
      <p>Structured, prioritized insights feed directly into the <b>Policymaker Dashboard</b> for targeted action.</p>
    </td>
  </tr>
</table>

```mermaid
flowchart LR
    A[🗣️ Citizen] --> B[💻 Web Portal]
    B --> C[⚙️ Express.js API]
    C --> D[(🛢️ MySQL DB)]
    D --> E[🤖 Google Gemini AI]
    E --> F[📊 Classification & Urgency]
    F --> G[🏛️ Policymaker Dashboard]
    G --> H[✅ Issue Resolution]

    style E fill:#1a73e8,color:#fff,stroke-width:0px
    style G fill:#1e8e3e,color:#fff,stroke-width:0px
