# Lead Finder & Sales Pipeline Dashboard

An open-source, full-stack lead generation engine and sales pipeline management system. This application automates Google Maps business discovery, website availability and technology audits, outreach pitch synthesis, and lead lifecycle tracking within a unified dashboard interface.

---

## Quick Start & Installation Guide

### Prerequisites
- **Node.js**: v18.0.0 or higher  
- **npm**: v9.0.0 or higher  

### Step 1: Clone the Repository
```bash
git clone https://github.com/your-organization/lead-finder-dashboard.git
cd lead-finder-dashboard
```

### Step 2: Install Node Dependencies
```bash
npm install
```

### Step 3: Install Headless Browser Binaries
Install Playwright or Puppeteer browser binaries required for the scraper engine:

```bash
npx playwright install chromium
```

### Step 4: Verify Directory Structure
Ensure your root project matches the following layout before launching:

```text
lead-finder-dashboard/
├── public/
│   └── index.html          # Dashboard UI Markup, CSS & Socket Client
│── scraper.js          # Google Maps & Web Audit Module
│── pitchGenerator.js   # Dynamic Pitch Script Builder
│── leads.csv         # Lead Persistence Logic
├── server.js               # Express Router & Socket.IO Entry Point
├── package.json            # Scripts & Dependencies
└── README.md               # System Documentation
```

### Step 5: Launch the Application

**Development Mode (Hot Reloading):**
```bash
npm run dev
```

**Production Mode:**
```bash
npm start
```

Access the live dashboard in your browser:

```text
http://localhost:3000
```

---

## Overview

Finding and vetting local business leads manually requires substantial effort. This platform automates the standard lead acquisition lifecycle into four sequential steps:

1. **Discovery**: Queries local business listings via geographical parameters or browser geolocation.  
2. **Audit**: Analyzes discovered websites for connectivity, tech stack signatures, and structural flaws.  
3. **Scripting**: Assembles tailored outreach scripts addressing the specific issues identified during auditing.  
4. **Pipeline Tracking**: Updates lead statuses and provides one-click channels for direct outreach.  

---

## Workflow Logic & Architecture

```text
+-------------------------------------------------------------------+
|                        Dashboard Frontend                         |
|   (HTML5, CSS Custom Properties, Vanilla JS, Socket.IO Client)    |
+-------------------------------------------------------------------+
       |                                                        ^
  REST API & WebSockets                                   Real-Time Logs
       |                                                        |
+----v--------------------------------------------------------+----+
|                          Express Server                           |
|              (Node.js Controller & Routing Engine)                |
+-------------------------------------------------------------------+
       |                                                        |
+----v-----------------------+                        +-------v----+
|    Browser Automation      |                        |  Lead Data |
| (Google Maps Scraper Engine) |                        | Repository |
+----------------------------+                        +------------+
       |
+----v-----------------------+
|   Website Auditor & Tech   |
|     Stack Inspector        |
+----------------------------+
       |
+----v-----------------------+
| Tailored Pitch Scripting   |
|       Generator            |
+----------------------------+
```

---

## Detailed Logic Execution

### 1. Search Query & Geolocation Resolution

- **Manual Query**: Combines the requested industry sector (e.g., `Plumbers`) with an explicit target location (e.g., `Austin, TX`).  
- **Geolocation Mode**: Requests browser device coordinates via `navigator.geolocation`. Sends precise latitude/longitude pairs to the server to run radius-bound spatial searches.  

### 2. Web Scraping Engine

- Launches an isolated headless Chromium instance to navigate Google Maps DOM structures.  
- Extracts structured metadata for each result:  
  - Company Name & Category  
  - Review Count & Average Star Rating  
  - Phone Number & Address  
  - Listed Domain URL  

### 3. Automated Website Auditor

Every lead with an associated URL undergoes an asynchronous network check:

**Domain Health Categorization:**

- ✅ **Active Site**: Resolves successfully with an HTTP `200 OK` status code.  
- ❌ **Inaccessible / Down**: Times out, throws DNS errors, or returns HTTP `4xx/5xx` status codes.  
- ❌ **Missing Website**: No external web link is listed on Google Maps.  

**Technology Signature Extraction:**  
Analyzes DOM element structures, meta tags, and JavaScript runtime variables to identify platforms (WordPress, Shopify, Squarespace, Wix, React).

### 4. Automated Pitch Script Builder

Generates tailored value propositions based on audit findings:

- **Missing Site**: Formulates an offer centered on site design, hosting setup, and local SEO initialization.  
- **Inaccessible Site**: Emphasizes lost revenue from downtime and offers immediate technical recovery.  
- **Legacy Tech Stack**: Focuses on modernizing UI/UX, page load speed optimization, and mobile conversion improvements.  

### 5. Real-Time Socket Feedback Loop

- Scraper activity stream events are broadcast over WebSockets using Socket.IO.  
- The client logs incoming messages in a terminal interface with timestamps, maintaining full transparency during execution without page refreshes.  

---

## Features & UI Components

- **Adaptive Query Controls**: Input fields for Business Type, Location, Max Results, and “Near Me” override.  
- **Metrics Dashboard**: Monitors total leads, contacted prospects, identified opportunities, and overall conversion rate percentage.  
- **Terminal Log Window**: Toggleable real-time stream (**View Logs / Hide Logs**) displaying execution steps and error diagnostics.  
- **Lead Record Cards**: Summarizes phone, category, and review metadata, with an expandable drawer for detailed technical audits and scripts.  

**One-Click Communication Protocols:**

- **WhatsApp Integration**: Formats recipient phone numbers and pre-fills pitch copy via standard `wa.me` URL schemes.  
- **Email Integration**: Auto-generates pre-filled `mailto:` links with subject line and body text.  

**Pipeline Management:**

- Client-side filtering by pipeline status (`New`, `Contacted`, `In Progress`, `Closed`) and instant keyword search.  

---

## API & Socket Event Reference

### REST Endpoints

| Method | Endpoint             | Description                                                  |
|--------|----------------------|--------------------------------------------------------------|
| GET    | `/api/leads`         | Fetches all persisted lead records.                          |
| POST   | `/api/leads/update`  | Updates the pipeline status (`New`, `Contacted`, etc.) for a lead ID. |
| DELETE | `/api/leads/:id`     | Deletes a specified lead record.                             |

### Socket.IO Events

| Event            | Direction       | Payload                                                      | Description                                               |
|------------------|-----------------|--------------------------------------------------------------|-----------------------------------------------------------|
| `start-scrape`   | Client → Server | `{ businessType, location, maxResults, isNearMe, coords }`   | Initiates a new web scraping and auditing session.        |
| `progress`       | Server → Client | `string`                                                     | Emits timestamped execution updates to the client log box.|
| `scrape-complete`| Server → Client | `Array<LeadObject>`                                          | Emits the complete updated lead list to the client.       |

---

## Tech Stack

- **Frontend**: Vanilla JavaScript (ES6+), HTML5, CSS3 Custom Properties (CSS Grid/Flexbox)  
- **Backend Runtime**: Node.js  
- **Application Framework**: Express.js  
- **Real-time Engine**: Socket.IO  
- **Scraper Engine**: Playwright / Puppeteer  
- **Typography**: Plus Jakarta Sans  

---

## Open-Source License

This project is licensed under the **MIT License**.

```text
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
```
