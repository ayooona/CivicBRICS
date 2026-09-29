## 💡 How It Works

### ⚙️ Core Process Breakdown

<div align="center">

<table width="100%">
  <thead>
    <tr>
      <th width="33%" align="center">1️⃣ Ingestion</th>
      <th width="33%" align="center">2️⃣ AI Processing</th>
      <th width="33%" align="center">3️⃣ Resolution</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="left">
        <ul>
          <li><b>Multilingual Support:</b> Accepts complaints in regional/native languages.</li>
          <li><b>Web Portal Access:</b> Simple submission UI for citizen engagement.</li>
        </ul>
      </td>
      <td align="left">
        <ul>
          <li><b>Backend Routing:</b> Express.js processes raw payload into MySQL DB.</li>
          <li><b>Gemini Engine:</b> Performs NLP, categorization, and urgency scoring.</li>
        </ul>
      </td>
      <td align="left">
        <ul>
          <li><b>Actionable Insights:</b> Feeds structured data into official dashboard.</li>
          <li><b>Targeted Action:</b> Enables swift policy-driven response.</li>
        </ul>
      </td>
    </tr>
  </tbody>
</table>

</div>

<br>

---

### 🔄 System Architecture Flow

```mermaid
graph LR
    subgraph Client Layer
        A[🗣️ Citizen] --> B[💻 Web Portal]
    end

    subgraph Core Backend
        B --> C[⚙️ Express.js API]
        C --> D[(🛢️ MySQL DB)]
    end

    subgraph Intelligence Engine
        D --> E[🤖 Google Gemini AI]
        E --> F[📊 Urgency & Category Engine]
    end

    subgraph Governance Layer
        F --> G[🏛️ Policymaker Dashboard]
        G --> H[✅ Targeted Resolution]
    end

    style A fill:#f4f6f8,stroke:#333,stroke-width:1px
    style E fill:#1a73e8,color:#fff,stroke-width:0px
    style F fill:#e8f0fe,stroke:#1a73e8,stroke-width:1px
    style G fill:#1e8e3e,color:#fff,stroke-width:0px
