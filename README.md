# Placement-Lead-Management-System
A real-time Firebase-powered lead management system with authentication, role-based access, collaborative comments, status tracking, and analytics for streamlined placement coordination.

A web-based system to manage company leads, track status updates, assign users, and collaborate with comments.  
Built with **Firebase (Auth + Firestore)** and vanilla **JavaScript/HTML/CSS**.

---

## 🚀 Features
- 🔑 **User Authentication**
  - Signup/Login with Firebase Authentication
  - Role-based access control (Admin / Member)
  - Inactive accounts pending admin approval

- 📝 **Leads Management**
  - Create, edit, and delete leads
  - Track company, role, contacts, description, tags
  - Lead assignment to users
  - Status lifecycle

- 💬 **Comments & Activity Logs**
  - Comment on each lead
  - System logs for creation, edits, and status changes
  - Audit trail: who changed what, when

- 📊 **Analytics Dashboard**
  - Status distribution
  - Weekly / Monthly / Daily trends
  - User and lead activity stats

- ⚙️ **Admin Tools**
  - Manage user roles and activation
  - View recent activity across all leads

---

## 🛠️ Tech Stack
- **Frontend:** HTML, CSS, JavaScript
- **Backend:** Firebase Authentication & Firestore
- **Hosting:** Firebase Hosting

---

## 📂 Project Structure
project-root/
│── index.html # Main UI
│── style.css # Styling
│── app.js # App logic (frontend)
│── auth.js # Authentication logic
│── database.js # Firestore database service
│── /assets # Images, icons, etc.
│── README.md # This file

