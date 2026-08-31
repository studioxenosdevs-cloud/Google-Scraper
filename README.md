# Google Maps Lead Scraper & Pitch Dashboard

An automated lead generation tool that scrapes local business listings from Google Maps, performs technical audits on their websites, and drafts sales pitches.

## Features

- **Google Maps Scraper**: Scrapes listings, contact numbers, reviews, website links, and location data.
- **Website Auditor**: Checks SSL status, mobile viewport tags, load speeds, tech stack, and missing contact forms.
- **Pitch Generator**: Drafts sales pitches tailored to each business's audit findings.
- **Individual Deletion**: Dustbin trash icon on each lead to delete individual leads from the database (`leads.csv`).
- **Responsive Dashboard**: Mobile and PC UI with real-time Socket.IO feedback.

## Installation

```bash
npm install
npx playwright install chromium
npm start