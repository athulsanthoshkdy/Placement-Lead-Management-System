// Main Application - No Storage Version with Lead Search, Edit, and CSV Features
class PlacementLeadSystem {
  constructor() {
    this.currentUser = null;
    this.userRole = null;
    this.currentLeadId = null;
    this.config = null;
    this.unsubscribeFunctions = [];
    this.isEditingLead = true;
    // 🆕 cache users globally for filters, modal dropdowns, and CSV export
    this.users = [];
    this.usersById = {};
    // 🆕 Add/Edit mode tracking
    this.isEditingMode = false;
    this.editingLeadId = null;
    this.originalLeadData = null;
    this.collectedMentions = this.collectedMentions || new Set();

    this.init();
  }

  async init() {
    console.log('Initializing Placement Lead Management System...');
    
    // Wait for Firebase to be ready
    if (!window.firebaseApp) {
      console.error('Firebase not initialized');
      return;
    }

    this.config = window.DatabaseService.getConfig();

    this.setupEventListeners();
    this.setupAuthStateListener();
    await this.loadUsersForFilter();
    this.setupMentionAutocomplete();

    window.DatabaseService.onUsersSnapshot((users) => {
      this.users = users || [];
      this.loadUsersForFilter(); // update filters dropdown in UI
      this.setupMentionAutocomplete(); // ensure autocomplete uses latest users
    });
  }

  renderNotificationsPanel(notifications) {
    const panel = document.getElementById('notificationsPanel');
    if (!panel) return;

    // Show unread count on bell icon
    const unreadCount = notifications.filter(n => !n.isRead).length;
    const icon = document.getElementById('notificationBellIcon');
    if (icon) {
      icon.dataset.unread = unreadCount > 0 ? unreadCount : '';
    }

    // Render notifications list
    panel.innerHTML = notifications.length
      ? notifications.map(n => `
        <div class="notification-item${n.isRead ? '' : ' unread'}" data-id="${n.id}" data-leadid="${n.leadId}">
          <span>${n.message}</span>
          <span class="notification-time">${this.formatTimeAgo(n.createdAt)}</span>
        </div>`).join('')
      : "<div class='notification-empty'>No notifications</div>";

    // Click handler for each notification
    panel.querySelectorAll('.notification-item').forEach(item => {
      item.onclick = () => this.handleNotificationClick(item.dataset.id, item.dataset.leadid);
    });
  }

  async handleNotificationClick(notificationId, leadId) {
    await window.DatabaseService.markNotificationAsRead(notificationId);
    if (leadId) this.openLeadModal(leadId);
  }

  // Optionally, add a helper to format time nicely:
  formatTimeAgo(ts) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const now = new Date();
    const sec = Math.floor((now - d) / 1000);
    if (sec < 60) return 'Just now';
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
    return `${Math.floor(sec / 86400)}d ago`;
  }

  async sendEmailToLead(lead) {
    try {
      const template = await window.DatabaseService.getEmailTemplate();
      if (!template || !template.subject || !template.body || !template.signature) {
        this.showToast('Cannot send email without template', 'error');
        return;
      }

      // Replace placeholders with lead details
      let subject = template.subject
        .replace('{{companyName}}', lead.companyName || '')
        .replace('{{contactPerson}}', lead.contactPerson || '')
        .replace('{{jobRole}}', lead.jobRole || '');

      let body = template.body
        .replace('{{companyName}}', lead.companyName || '')
        .replace('{{contactPerson}}', lead.contactPerson || '')
        .replace('{{jobRole}}', lead.jobRole || '');

      body += `\n\n${template.signature}`;

      // Gmail compose link
      const gmailLink = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(lead.contactEmail)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

      // Open Gmail compose in new tab
      window.open(gmailLink, "_blank");
    } catch (error) {
      console.error("Error sending email:", error);
      this.showToast('Failed to open Gmail compose', 'error');
    }
  }

  enableLeadEdit(leadId) {
    this.currentLeadId = leadId;
    this.isEditingLead = false;
    
    const lead = this.allLeads.find(l => l.id === leadId);
    if (!lead) return;

    const container = document.querySelector(`[onclick="openLeadModal('${leadId}')"]`);
    if (!container) return;

    // Replace static values with editable inputs
    container.querySelector('.lead-details').innerHTML = `
      <div class="lead-detail-item">
        <span class="lead-detail-label">Company:</span>
        <input type="text" class="form-control" value="${lead.companyName}" id="editCompanyName">
      </div>
      <div class="lead-detail-item">
        <span class="lead-detail-label">Role:</span>
        <input type="text" class="form-control" value="${lead.jobRole}" id="editJobRole">
      </div>
      <div class="lead-detail-item">
        <span class="lead-detail-label">Contact:</span>
        <input type="text" class="form-control" value="${lead.contactPerson}" id="editContactPerson">
      </div>
      <div class="lead-detail-item">
        <span class="lead-detail-label">Email:</span>
        <input type="email" class="form-control" value="${lead.contactEmail}" id="editContactEmail">
      </div>
    `;

    // Add save + cancel buttons
    container.querySelector('.lead-footer').innerHTML = `
      <button class="btn btn--sm btn--primary"
        onclick="event.stopPropagation(); window.plmsApp.saveLeadEdits('${leadId}')">Save</button>
      <button class="btn btn--sm btn--outline"
        onclick="event.stopPropagation(); window.plmsApp.cancelLeadEdit()">Cancel</button>
    `;
  }

  async saveLeadEdits(leadId) {
    const oldLead = this.allLeads.find(l => l.id === leadId);
    if (!oldLead) return;
    
    const updates = {
      companyName: document.getElementById('editCompanyName').value,
      jobRole: document.getElementById('editJobRole').value,
      contactPerson: document.getElementById('editContactPerson').value,
      contactEmail: document.getElementById('editContactEmail').value,
      updatedAt: window.firebaseApp.serverTimestamp()
    };

    try {
      await window.DatabaseService.updateLead(leadId, updates);
      
      this.showToast('Lead updated successfully', 'success');

      // log changes in comments
      const userData = await window.AuthService.getUserData(this.currentUser);
      const creatorName = userData?.name || this.currentUser.displayName || this.currentUser.email;

      for (const key in updates) {
        if (key === "updatedAt") continue;
        if (updates[key] !== oldLead[key]) {
          await window.DatabaseService.addComment(leadId, {
            content: `${creatorName} changed ${key} from "${oldLead[key] || '—'}" to "${updates[key] || '—'}"`
          }, this.currentUser.uid);
        }
      }
    } catch (err) {
      console.error('Error updating lead:', err);
      this.showToast('Failed to update lead', 'error');
    }
    this.isEditingLead = true;
  }

  cancelLeadEdit() {
    this.isEditingLead = true;
    this.renderLeads(this.allLeads, this.filteredLeads);
  }

  // 🆕 CSV Template Download
  downloadCsvTemplate() {
    const headers = [
      "companyName",
      "jobRole", 
      "contactPerson",
      "contactEmail",
      "contactPhone",
      "source",
      "description",
      "jobDescriptionLink",
      "tags"
    ];
    
    const sampleData = [
      [
        "Tech Corp",
        "Software Engineer",
        "John Doe",
        "john@techcorp.com",
        "0000000000",
        "LinkedIn",
        "Full-time software engineering role requiring 3+ years experience",
        "https://techcorp.com/jobs/123",
        "Tech,Full-time,MNC"
      ]
    ];
    
    const csvContent = [headers, ...sampleData].map(row => 
      row.map(cell => `"${cell}"`).join(",")
    ).join("\n");
    
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lead_import_template.csv";
    link.click();
    URL.revokeObjectURL(url);
    
    this.showToast("CSV template downloaded", "success");
  }

  // 🆕 Handle CSV File Selection
  handleCsvFileSelect() {
    const fileInput = document.getElementById('csvFileInput');
    const selectBtn = document.getElementById('selectCsvBtn');
    const importBtn = document.getElementById('importCsvBtn');
    
    fileInput.click();
    
    fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (file && file.type === 'text/csv') {
        selectBtn.textContent = `📤 ${file.name}`;
        importBtn.style.display = 'inline-flex';
        this.previewCsvFile(file);
      } else {
        this.showToast("Please select a valid CSV file", "error");
      }
    };
  }

  // 🆕 Preview CSV File
  async previewCsvFile(file) {
    try {
      const text = await file.text();
      const lines = text.split('\n').filter(line => line.trim());
      const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
      const preview = document.getElementById('csvPreview');
      const content = document.getElementById('csvPreviewContent');
      
      let tableHTML = '<table><thead><tr>';
      headers.forEach(header => {
        tableHTML += `<th>${header}</th>`;
      });
      tableHTML += '</tr></thead><tbody>';
      
      // Show first 3 data rows as preview
      const dataRows = lines.slice(1, 4);
      dataRows.forEach(row => {
        const cells = row.split(',').map(c => c.replace(/"/g, '').trim());
        tableHTML += '<tr>';
        cells.forEach(cell => {
          tableHTML += `<td>${cell || '—'}</td>`;
        });
        tableHTML += '</tr>';
      });
      
      tableHTML += '</tbody></table>';
      tableHTML += `<p class="preview-note">Showing preview of ${Math.min(3, dataRows.length)} rows. Total rows to import: ${lines.length - 1}</p>`;
      
      content.innerHTML = tableHTML;
      preview.style.display = 'block';
      
    } catch (error) {
      console.error('Error previewing CSV:', error);
      this.showToast("Error reading CSV file", "error");
    }
  }

  // 🆕 Import CSV Data
  async importCsvData() {
    const fileInput = document.getElementById('csvFileInput');
    const file = fileInput.files[0];
    
    if (!file) {
      this.showToast("No file selected", "error");
      return;
    }
    
    try {
      this.showToast("Importing leads...", "info");
      
      const text = await file.text();
      const lines = text.split('\n').filter(line => line.trim());
      const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
      
      let successCount = 0;
      let errorCount = 0;
      
      for (let i = 1; i < lines.length; i++) {
        try {
          const values = lines[i].split(',').map(v => v.replace(/"/g, '').trim());
          const leadData = {};
          
          headers.forEach((header, index) => {
            const value = values[index] || '';
            if (header === 'tags') {
              leadData[header] = value ? value.split(',').map(t => t.trim()) : [];
            } else {
              leadData[header] = value;
            }
          });
          
          // Validate required fields
          if (!leadData.companyName || !leadData.jobRole) {
            console.warn(`Skipping row ${i + 1}: Missing required fields`);
            errorCount++;
            continue;
          }
          
          await window.DatabaseService.createLead(leadData, this.currentUser.uid);
          successCount++;
          
        } catch (error) {
          console.error(`Error importing row ${i + 1}:`, error);
          errorCount++;
        }
      }
      
      const message = `Import complete: ${successCount} successful, ${errorCount} errors`;
      this.showToast(message, successCount > 0 ? "success" : "error");
      
      // Reset form
      this.resetCsvImport();
      
    } catch (error) {
      console.error('Error importing CSV:', error);
      this.showToast("Error importing CSV file", "error");
    }
  }

  // 🆕 Reset CSV Import UI
  resetCsvImport() {
    document.getElementById('csvFileInput').value = '';
    document.getElementById('selectCsvBtn').textContent = '📤 Select CSV File';
    document.getElementById('importCsvBtn').style.display = 'none';
    document.getElementById('csvPreview').style.display = 'none';
  }

  // 🆕 Search and Populate Lead for Editing
  async searchAndPopulateLead() {
    const leadId = document.getElementById('leadSearchInput').value.trim();
    
    if (!leadId) {
      this.showToast("Please enter a Lead ID", "error");
      return;
    }
    
    try {
      const lead = await window.DatabaseService.getLead(leadId);
      
      if (!lead) {
        this.showToast("Lead not found", "error");
        return;
      }
      
      // Switch to edit mode
      this.switchToEditMode(lead);
      this.showToast("Lead loaded for editing", "success");

      const isAdmin = this.userRole === 'admin';
      this.toggleAddLeadLock(!isAdmin); // members locked, admins editable

      const submitBtn = document.getElementById('submitLeadBtn');
      if (submitBtn) submitBtn.textContent = isAdmin ? 'Save Updates' : 'View Only';

      if (!isAdmin) this.showToast('View-only mode: only admins can edit this lead', 'info');
      
    } catch (error) {
      console.error('Error searching lead:', error);
      this.showToast("Error searching for lead", "error");
    }
  }

  // 🆕 Switch to Edit Mode
  switchToEditMode(lead) {
    this.isEditingMode = true;
    this.editingLeadId = lead.id;
    this.originalLeadData = { ...lead };
    
    // Update UI elements
    document.getElementById('addLeadPageTitle').textContent = 'Edit Lead';
    document.getElementById('addLeadPageSubtitle').textContent = 'Update placement opportunity details';
    document.getElementById('submitLeadBtn').textContent = 'Save Updates';
    document.getElementById('editingLeadId').value = lead.id;
    
    // Add editing mode class
    document.getElementById('addLeadPage').classList.add('editing-mode');
    
    // Populate form fields
    this.populateFormWithLead(lead);
  }

  // 🆕 Switch to Add Mode
  switchToAddMode() {
    this.toggleAddLeadLock(false);
    this.isEditingMode = false;
    this.editingLeadId = null;
    this.originalLeadData = null;
    
    // Update UI elements
    document.getElementById('addLeadPageTitle').textContent = 'Add New Lead';
    document.getElementById('addLeadPageSubtitle').textContent = 'Submit a new placement opportunity';
    document.getElementById('submitLeadBtn').textContent = 'Submit Lead';
    document.getElementById('editingLeadId').value = '';
    
    // Remove editing mode class
    document.getElementById('addLeadPage').classList.remove('editing-mode');
    
    // Clear form
    this.clearAddLeadFormInternal();
  }

  // 🆕 Populate Form with Lead Data
  populateFormWithLead(lead) {
    const fieldMappings = {
      'companyName': 'companyName',
      'jobRole': 'jobRole', 
      'contactPerson': 'contactPerson',
      'contactEmail': 'contactEmail',
      'contactPhone': 'contactPhone',
      'source': 'source',
      'description': 'description',
      'jobDescriptionLink': 'jobDescriptionLink'
    };
    
    // Populate text fields
    for (const [formField, leadField] of Object.entries(fieldMappings)) {
      const element = document.getElementById(formField);
      if (element) {
        element.value = lead[leadField] || '';
      }
    }
    
    // Handle tags
    if (lead.tags && Array.isArray(lead.tags)) {
      const checkboxes = document.querySelectorAll('.tag-checkbox input[type="checkbox"]');
      checkboxes.forEach(checkbox => {
        const label = checkbox.parentElement;
        if (lead.tags.includes(checkbox.value)) {
          checkbox.checked = true;
          label.classList.add('selected');
        } else {
          checkbox.checked = false;
          label.classList.remove('selected');
        }
      });
    }
  }

  // 🆕 Clear Form (Internal)
  clearAddLeadFormInternal() {
    // Clear all input fields
    const inputs = document.querySelectorAll('#addLeadForm input, #addLeadForm select, #addLeadForm textarea');
    inputs.forEach(input => {
      if (input.type === 'checkbox') {
        input.checked = false;
        input.parentElement.classList.remove('selected');
      } else if (input.type !== 'hidden') {
        input.value = '';
      }
    });
    
    // Clear search input
    document.getElementById('leadSearchInput').value = '';
  }

  // 🆕 Update Lead with Change Tracking
  async updateLeadWithTracking(leadId, newData) {
    try {
      // Get current user name
      let creatorName = "Unknown User";
      const creator = await window.DatabaseService.getUser(this.currentUser.uid);
      if (creator) {
        creatorName = creator.name || creator.email || this.currentUser.uid;
      }
      
      // Track changes and add comments
      for (const [key, newValue] of Object.entries(newData)) {
        const oldValue = this.originalLeadData[key];
        
        // Skip if values are the same
        if (this.valuesAreEqual(newValue, oldValue)) continue;
        
        // Format values for display
        const formatValue = (val) => {
          if (val === null || val === undefined || val === '') return '—';
          if (Array.isArray(val)) return val.join(', ') || '—';
          return String(val);
        };
        
        const formattedOld = formatValue(oldValue);
        const formattedNew = formatValue(newValue);
        
        // Add change comment
        await window.DatabaseService.addComment(leadId, {
          content: `${creatorName} changed ${key} from "${formattedOld}" to "${formattedNew}"`
        }, this.currentUser.uid);
      }
      
      // Update the lead
      await window.DatabaseService.updateLead(leadId, newData);
      
    } catch (error) {
      console.error('Error updating lead with tracking:', error);
      throw error;
    }
  }

  // 🆕 Helper method to compare values (handles arrays)
  valuesAreEqual(newVal, oldVal) {
    if (Array.isArray(newVal) && Array.isArray(oldVal)) {
      return JSON.stringify(newVal.sort()) === JSON.stringify(oldVal.sort());
    }
    return newVal === oldVal;
  }

  updateTrendChart(range = "monthly") {
    if (!this.analytics) return;

    let trends;
    if (range === "daily") {
      trends = this.analytics.dailyTrends;
    } else if (range === "weekly") {
      trends = this.analytics.weeklyTrends;
    } else {
      trends = this.analytics.monthlyTrends;
    }

    this.renderTimeChart(trends);
  }

  setupAuthStateListener() {
    // Listen for authentication state changes
    this.authUnsubscribe = window.AuthService.onAuthStateChanged(async (user, role) => {
      this.currentUser = user;
      this.userRole = role;
      
      if (user && role) {
        // 🔒 Check if user is active
        const userData = await window.AuthService.getUserData(user);
        if (!userData?.isActive) {
          console.warn("Inactive user tried to log in:", user.email);
          this.showToast("Your account is inactive. Please contact admin.", "error");
          await window.AuthService.logout();
          return;
        }

        console.log('User authenticated:', user.email, 'Role:', role);
        await this.showMainApp();
      } else {
        console.log('User not authenticated');
        this.showAuthPage();
      }
    });
  }

  setupEventListeners() {
    document.addEventListener('DOMContentLoaded', () => {
      this.bindEvents();
    });
    
    if (document.readyState !== 'loading') {
      this.bindEvents();
    }
  }

  bindEvents() {
    // Auth forms
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    
    if (loginForm) {
      loginForm.addEventListener('submit', (e) => this.handleLogin(e));
    }
    
    if (registerForm) {
      registerForm.addEventListener('submit', (e) => this.handleRegister(e));
    }

    // Auth switcher
    const showRegister = document.getElementById('showRegister');
    const showLogin = document.getElementById('showLogin');
    
    if (showRegister) {
      showRegister.addEventListener('click', () => this.showRegisterForm());
    }
    
    if (showLogin) {
      showLogin.addEventListener('click', () => this.showLoginForm());
    }

    // Add lead form
    const addLeadForm = document.getElementById('addLeadForm');
    if (addLeadForm) {
      addLeadForm.addEventListener('submit', (e) => this.handleAddLead(e));
    }

    // Comment form
    const commentForm = document.getElementById('commentForm');
    if (commentForm) {
      commentForm.addEventListener('submit', (e) => this.handleAddComment(e));
    }

    // 🆕 Lead search and populate
    const searchLeadBtn = document.getElementById('searchLeadBtn');
    if (searchLeadBtn) {
      searchLeadBtn.addEventListener('click', () => this.searchAndPopulateLead());
    }

    // 🆕 Clear form
    const clearFormBtn = document.getElementById('clearFormBtn');
    if (clearFormBtn) {
      clearFormBtn.addEventListener('click', () => this.switchToAddMode());
    }

    // 🆕 CSV operations
    const downloadTemplateBtn = document.getElementById('downloadCsvTemplateBtn');
    if (downloadTemplateBtn) {
      downloadTemplateBtn.addEventListener('click', () => this.downloadCsvTemplate());
    }

    const selectCsvBtn = document.getElementById('selectCsvBtn');
    if (selectCsvBtn) {
      selectCsvBtn.addEventListener('click', () => this.handleCsvFileSelect());
    }

    const importCsvBtn = document.getElementById('importCsvBtn');
    if (importCsvBtn) {
      importCsvBtn.addEventListener('click', () => this.importCsvData());
    }

    // 🆕 Allow Enter key on search input
    const leadSearchInput = document.getElementById('leadSearchInput');
    if (leadSearchInput) {
      leadSearchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          this.searchAndPopulateLead();
        }
      });
    }

    // Search and filters
    this.setupFiltersAndSearch();

    // Export CSV button
    const exportBtn = document.getElementById('exportCsvBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        const leads = this.filteredLeads || this.allLeads || [];
        this.exportLeadsToCSV(leads);
      });
    }

    // Modal events
    const modal = document.getElementById('leadModal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          this.closeLeadModal();
        }
      });
    }

    // Status dropdown change
    const statusDropdown = document.getElementById('statusDropdown');
    if (statusDropdown) {
      statusDropdown.addEventListener('change', () => this.updateLeadStatus());
    }
  }

  setupFiltersAndSearch() {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      let searchTimeout;
      searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => this.applyFilters(), 300);
      });
    }

    const filters = ['statusFilter', 'tagFilter', 'createdByFilter','assignedToFilter'];
    filters.forEach(filterId => {
      const filterElement = document.getElementById(filterId);
      if (filterElement) {
        filterElement.addEventListener('change', () => this.applyFilters());
      }
    });
  }

  // 🆕 Helper: get user display name by uid (fallback to uid)
  getUserName(uid) {
    const u = this.usersById[uid];
    return u?.name || u?.email || uid || '';
  }

  exportLeadsToCSV(leads) {
    if (!leads || leads.length === 0) {
      this.showToast("No leads to export", "error");
      return;
    }

    const headers = [
      "Company Name",
      "Job Role",
      "Contact Person",
      "Contact Email",
      "Contact Phone",
      "Source",
      "Status",
      "Tags",
      "Created By",
      "Created At"
    ];

    const rows = leads.map(lead => [
      `"${lead.companyName || ''}"`,
      `"${lead.jobRole || ''}"`,
      `"${lead.contactPerson || ''}"`,
      `"${lead.contactEmail || ''}"`,
      `"${lead.contactPhone || ''}"`,
      `"${lead.source || ''}"`,
      `"${lead.status || ''}"`,
      `"${(lead.tags || []).join(", ")}"`,
      // 🆕 export creator *name* instead of raw uid
      `"${this.getUserName(lead.createdBy)}"`,
      `"${lead.createdAt?.toDate ? lead.createdAt.toDate().toLocaleString() : ''}"`
    ]);

    const csvContent = [headers, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `leads_export_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();

    URL.revokeObjectURL(url);
  }

  // AUTH METHODS
  async handleLogin(e) {
    e.preventDefault();
    
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!email || !password) {
      this.showToast('Please enter both email and password', 'error');
      return;
    }

    const submitButton = e.target.querySelector('button[type="submit"]');
    const originalText = submitButton.textContent;
    
    try {
      submitButton.textContent = 'Signing in...';
      submitButton.disabled = true;

      const userCred = await window.AuthService.login(email, password);

      // 🔎 Check Firestore "isActive"
      const userData = await window.AuthService.getUserData(userCred);
      if (!userData?.isActive) {
        await window.AuthService.logout();
        this.showToast('Your account is inactive. Please contact admin.', 'error');
        return; // ⛔ stop here — don't show success
      }
      this.showToast('Login successful!', 'success');
    } catch (error) {
      console.error('Login error:', error);
      this.showToast(this.getAuthErrorMessage(error), 'error');
    } finally {
      submitButton.textContent = originalText;
      submitButton.disabled = false;
    }
  }

  async handleRegister(e) {
    e.preventDefault();
    
    const name = document.getElementById('registerName').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    if (!name || !email || !password || !confirmPassword) {
      this.showToast('Please fill in all fields', 'error');
      return;
    }

    if (password !== confirmPassword) {
      this.showToast('Passwords do not match', 'error');
      return;
    }

    if (password.length < 6) {
      this.showToast('Password must be at least 6 characters', 'error');
      return;
    }

    const submitButton = e.target.querySelector('button[type="submit"]');
    const originalText = submitButton.textContent;
    
    try {
      submitButton.textContent = 'Creating Account...';
      submitButton.disabled = true;

      await window.AuthService.register(email, password, name);
      this.showToast('Account created successfully!', 'success');

      this.showToast(
        'Account created successfully. Please wait for admin approval before logging in.',
        'success'
      );

      // Switch back to login form
      document.getElementById('registerForm').classList.add('hidden');
      document.getElementById('loginForm').classList.remove('hidden');
      document.getElementById('authSubtitle').textContent = "Sign in to manage placement opportunities";

    } catch (error) {
      console.error('Registration error:', error);
      this.showToast(this.getAuthErrorMessage(error), 'error');
    } finally {
      submitButton.textContent = originalText;
      submitButton.disabled = false;
    }
  }

  // Utility: convert status text into a CSS class
  formatStatusClass(status) {
    return "status-" + status.toLowerCase().replace(/\s+/g, "-");
  }

  async handleLogout() {
    try {
      // Clean up subscriptions
      this.cleanupSubscriptions();
      
      await window.AuthService.logout();
      this.showToast('Logged out successfully', 'success');
    } catch (error) {
      console.error('Logout error:', error);
      this.showToast('Error logging out', 'error');
    }
  }

  getAuthErrorMessage(error) {
    switch (error.code) {
      case 'auth/user-not-found':
      case 'auth/wrong-password':
        return 'Invalid email or password';
      case 'auth/email-already-in-use':
        return 'Email is already registered';
      case 'auth/weak-password':
        return 'Password is too weak';
      case 'auth/invalid-email':
        return 'Invalid email address';
      default:
        return error.message || 'Authentication error';
    }
  }

  showAuthPage() {
    document.getElementById('authPage').classList.remove('hidden');
    document.getElementById('mainApp').classList.add('hidden');
    document.body.classList.remove('admin');
  }

  showLoginForm() {
    document.getElementById('loginForm').classList.remove('hidden');
    document.getElementById('registerForm').classList.add('hidden');
    document.getElementById('authSubtitle').textContent = 'Sign in to manage placement opportunities';
    document.getElementById('authSwitchText').innerHTML = 'Don\'t have an account? <button type="button" id="showRegister" class="auth-link">Sign up</button>';
    // Re-bind event
    document.getElementById('showRegister').addEventListener('click', () => this.showRegisterForm());
  }

  showRegisterForm() {
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('registerForm').classList.remove('hidden');
    document.getElementById('authSubtitle').textContent = 'Create your account to get started';
    document.getElementById('authSwitchText').innerHTML = 'Already have an account? <button type="button" id="showLogin" class="auth-link">Sign in</button>';
    
    // Re-bind event
    document.getElementById('showLogin').addEventListener('click', () => this.showLoginForm());
  }

  async showMainApp() {
    document.getElementById('authPage').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    
    // Set user info
    if (this.currentUser) {
      const userData = await window.AuthService.getUserData(this.currentUser);
      
      const userAvatar = document.getElementById('userAvatar');
      const userName = document.getElementById('userName');
      
      if (userAvatar && userData) {
        userAvatar.src = userData.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(userData.name)}&background=2563EB&color=fff`;
        userAvatar.alt = userData.name;
      }
      
      if (userName && userData) {
        userName.textContent = userData.name;
      }

      if (this.notificationsUnsubscribe) this.notificationsUnsubscribe(); // Clean old listener
      this.notificationsUnsubscribe = window.DatabaseService.onUserNotificationsSnapshot(
        this.currentUser.uid, 
        notifications => this.renderNotificationsPanel(notifications)
      );
    }
    
    // Set admin class
    if (this.userRole === 'admin') {
      document.body.classList.add('admin');
    } else {
      document.body.classList.remove('admin');
    }

    this.showPage('dashboard');
    this.setupFilters();
    this.setupAddLeadForm();
  }

  // PAGE NAVIGATION
  showPage(pageName) {
    // Clean up existing subscriptions
    this.cleanupSubscriptions();

    // Hide all pages
    document.querySelectorAll('.page-content').forEach(page => {
      page.classList.add('hidden');
    });

    // Remove active class from nav items
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.remove('active');
    });

    // Show selected page
    const targetPage = document.getElementById(pageName + 'Page');
    if (targetPage) {
      targetPage.classList.remove('hidden');
    }

    // Add active class to nav item
    const targetNav = document.querySelector(`[data-page="${pageName}"]`);
    if (targetNav) {
      targetNav.classList.add('active');
    }

    // Load page-specific content
    switch (pageName) {
      case 'dashboard':
        this.loadDashboard();
        break;
      case 'leads':
        this.loadLeads();
        break;
      case 'addLead':
        this.loadAddLeadPage();
        break;
      case 'admin':
        if (this.userRole === 'admin') {
          this.loadAdminPanel();
        }
        break;
    }
  }

  // DASHBOARD
  async loadDashboard() {
    try {
      const analytics = await window.DatabaseService.getAnalytics();
      this.analytics = analytics; // 👈 store it so dropdown can reuse

      this.updateDashboardStats(analytics);
      this.renderCharts(analytics);
      this.loadActivityFeed();
    } catch (error) {
      console.error('Error loading dashboard:', error);
      this.showToast('Error loading dashboard data', 'error');
    }
  }

  applyFilters() {
    if (!this.allLeads) return;

    const searchValue = document.getElementById('searchInput')?.value.trim().toLowerCase();
    const statusValue = document.getElementById('statusFilter')?.value;
    const tagValue = document.getElementById('tagFilter')?.value;
    const createdByValue = document.getElementById('createdByFilter')?.value;
    const assignedToValue = document.getElementById('assignedToFilter')?.value;

    let filtered = [...this.allLeads];

    // Search filter
    if (searchValue) {
      filtered = filtered.filter(lead =>
        (lead.companyName || '').toLowerCase().includes(searchValue)
      );
    }

    // Status filter
    if (statusValue) {
      filtered = filtered.filter(lead => lead.status === statusValue);
    }

    // Tag filter
    if (tagValue) {
      filtered = filtered.filter(lead => (lead.tags || []).includes(tagValue));
    }

    // Created By filter (keeps using uid values)
    if (createdByValue) {
      filtered = filtered.filter(lead => lead.createdBy === createdByValue);
    }
    if (assignedToValue) {
      filtered = filtered.filter(lead => lead.assignedTo === assignedToValue);
    }

    // Save + re-render
    this.filteredLeads = filtered;
    this.renderLeads(this.allLeads, filtered);
  }

  updateDashboardStats(analytics) {
    const elements = {
      totalLeads: document.getElementById('totalLeads'),
      activeLeads: document.getElementById('activeLeads'),
      closedLeads: document.getElementById('closedLeads'),
      successRate: document.getElementById('successRate')
    };

    if (elements.totalLeads) elements.totalLeads.textContent = analytics.totalLeads;
    if (elements.activeLeads) elements.activeLeads.textContent = analytics.activeLeads;
    if (elements.closedLeads) elements.closedLeads.textContent = analytics.closedLeads;
    
    const successRate = analytics.totalLeads > 0 ? 
      Math.round((analytics.closedLeads / analytics.totalLeads) * 100) : 0;
    if (elements.successRate) elements.successRate.textContent = successRate + '%';
  }

  renderCharts(analytics) {
    setTimeout(() => {
      this.renderStatusChart(analytics.statusDistribution);
      const range = document.getElementById('trendRange')?.value || 'monthly';
      this.updateTrendChart(range);
    }, 100);
  }

  renderStatusChart(statusDistribution) {
    const ctx = document.getElementById('statusChart');
    if (!ctx) return;

    if (window.statusChartInstance) {
      window.statusChartInstance.destroy();
    }

    const filteredData = Object.entries(statusDistribution)
      .filter(([_, count]) => count > 0);

    if (filteredData.length === 0) return;

    window.statusChartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: filteredData.map(([status]) => status),
        datasets: [{
          data: filteredData.map(([_, count]) => count),
          backgroundColor: [
            '#2563EB', '#F59E0B', '#10B981', '#EF4444', 
            '#8B5CF6', '#06B6D4', '#F97316', '#EC4899'
          ]
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom'
          }
        }
      }
    });
  }

  renderTimeChart(trends) {
    const ctx = document.getElementById('timeChart');
    if (!ctx || !trends) return;

    if (window.timeChartInstance) {
      window.timeChartInstance.destroy();
    }

    const keys = Object.keys(trends).sort();
    if (keys.length === 0) return;

    // Format labels depending on type
    let labels;
    if (keys[0].includes('-W')) {
      // Weekly format: YYYY-W## 
      labels = keys.map(k => {
        const [year, week] = k.split('-W');
        return `Week ${week}, ${year}`;
      });
    } else if (keys[0].match(/^\d{4}-\d{2}-\d{2}$/)) {
      // Daily format: YYYY-MM-DD
      labels = keys.map(k => {
        const date = new Date(k);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      });
    } else {
      // Monthly format: YYYY-MM
      labels = keys.map(k => {
        const [year, monthNum] = k.split('-');
        const date = new Date(year, monthNum - 1);
        return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      });
    }

    window.timeChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Leads Submitted',
          data: keys.map(k => trends[k]),
          borderColor: '#2563EB',
          backgroundColor: 'rgba(37, 99, 235, 0.1)',
          tension: 0.4,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              stepSize: 1
            }
          }
        }
      }
    });
  }

  async loadActivityFeed() {
    try {
      const activities = await window.DatabaseService.getRecentActivity(10);
      const container = document.getElementById('activityFeed');
      
      if (!container) return;

      if (activities.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--color-text-secondary); padding: 2rem;">No recent activity</p>';
        return;
      }

      container.innerHTML = activities.map(activity => `
        <div class="activity-item">
          <img src="${activity.user.avatar || ''}" alt="${activity.user.name}" class="activity-avatar">
          <div class="activity-content">
            <div class="activity-text">
              <strong>${activity.user.name}</strong> ${activity.content}
            </div>
            <div class="activity-time">${this.formatTimeAgo(activity.timestamp)}</div>
          </div>
        </div>
      `).join('');
    } catch (error) {
      console.error('Error loading activity feed:', error);
    }
  }

  // app.js — after role is known and when search/edit UI is invoked
  toggleAddLeadLock(isLocked) {
    const fs = document.getElementById('addLeadFieldset');
    if (fs) fs.disabled = !!isLocked; // disables and grays out the whole group
  }

  // LEADS
  loadLeads() {
    const unsubscribe = window.DatabaseService.onLeadsSnapshot((leads) => {
      this.renderLeads(leads);
    });
    this.unsubscribeFunctions.push(unsubscribe);
  }

  renderLeads(leads, filteredLeads = null) {

    this.allLeads = leads;
    this.filteredLeads = filteredLeads || leads;

    const container = document.getElementById('leadsContainer');
    if (!container) return;

    const leadsToRender = filteredLeads || leads;
    
    if (leadsToRender.length === 0) {
      container.innerHTML = '<div style="text-align: center; padding: 3rem; color: var(--color-text-secondary);">No leads found.</div>';
      return;
    }

    container.innerHTML = leadsToRender.map(lead => {
      const statusClass = lead.status.toLowerCase().replace(/\s+/g, '-');

      return `
        <div class="lead-card ${statusClass}" onclick="openLeadModal('${lead.id}')">
          <div class="lead-header">
            <div>
              <div class="lead-company">${lead.companyName}</div>
                <p>Lead ID: ${lead.id}</p>
              <div class="lead-role">${lead.jobRole}</div>
            </div>
            <span class="lead-status ${statusClass}">${lead.status}</span>
          </div>
          <div class="lead-details">
            <div class="lead-detail-item">
              <span class="lead-detail-label">Contact:</span>
              <span class="lead-detail-value">${lead.contactPerson}</span>
            </div>
            <div class="lead-detail-item">
              <span class="lead-detail-label">Source:</span>
              <span class="lead-detail-value">${lead.source || 'N/A'}</span>
            </div>
            <div class="lead-detail-item">
              <span class="lead-detail-label">Email:</span>
              <span class="lead-detail-value">
                ${lead.contactEmail || 'N/A'}
                ${lead.contactEmail && this.userRole === 'superadmin' ? `
                  <button class="btn btn--sm btn--outline email-btn"
                    onclick="event.stopPropagation(); window.plmsApp.sendEmailToLead({contactEmail: '${lead.contactEmail}', contactPerson: '${lead.contactPerson}'})">
                    Send Email
                  </button>` : ''}
              </span>
            </div>
          </div>
          <div class="lead-tags">
            ${(lead.tags || []).map(tag => `<span class="tag">${tag}</span>`).join('')}
          </div>
          <div class="lead-footer">
            <div class="lead-meta">
              Created ${this.formatDate(lead.createdAt)}
            </div>
            ${this.userRole === 'admin' ? `
              <button class="btn btn--sm btn--secondary edit-btn"
                onclick="event.stopPropagation(); window.plmsApp.enableLeadEdit('${lead.id}')">
                Edit
              </button>
            ` : ''}
          </div>

        </div>
      `;
    }).join('');

  }

  // LEAD FORM
  loadAddLeadPage() {
    this.setupAddLeadForm();
  }

  setupAddLeadForm() {
    // Populate sources
    const sourceSelect = document.querySelector('#addLeadForm select[name="source"]');
    if (sourceSelect && this.config) {
      sourceSelect.innerHTML = '<option value="">Select Source</option>' +
        this.config.sources.map(source => 
          `<option value="${source}">${source}</option>`
        ).join('');
    }

    // Setup tags
    const tagsContainer = document.getElementById('tagsContainer');
    if (tagsContainer && this.config) {
      tagsContainer.innerHTML = this.config.tags.map(tag => `
        <label class="tag-checkbox">
          <input type="checkbox" value="${tag}">
          <span>${tag}</span>
        </label>
      `).join('');

      // Handle tag selection
      tagsContainer.addEventListener('change', (e) => {
        if (e.target.type === 'checkbox') {
          const label = e.target.closest('.tag-checkbox');
          if (e.target.checked) {
            label.classList.add('selected');
          } else {
            label.classList.remove('selected');
          }
        }
      });
    }
  }

  // 🆕 Update handleAddLead method to handle both add and edit
  async handleAddLead(e) {
    e.preventDefault();
    
    if (!this.currentUser) {
      this.showToast('You must be logged in to add leads', 'error');
      return;
    }

    const submitButton = e.target.querySelector('button[type="submit"]');
    const originalText = submitButton.textContent;
    
    try {
      submitButton.textContent = this.isEditingMode ? 'Saving Updates...' : 'Adding Lead...';
      submitButton.disabled = true;

      const formData = new FormData(e.target);
      const selectedTags = Array.from(document.querySelectorAll('#tagsContainer input[type="checkbox"]:checked'))
        .map(cb => cb.value);

      const leadData = {
        companyName: formData.get('companyName'),
        jobRole: formData.get('jobRole'),
        contactPerson: formData.get('contactPerson'),
        contactEmail: formData.get('contactEmail'),
        contactPhone: formData.get('contactPhone') || '',
        source: formData.get('source') || '',
        tags: selectedTags,
        description: formData.get('description') || '',
        jobDescriptionLink: formData.get('jobDescriptionLink') || ''
      };

      if (this.isEditingMode) {
        // Update existing lead
        await this.updateLeadWithTracking(this.editingLeadId, leadData);
        this.showToast('Lead updated successfully!', 'success');
      } else {
        // Create new lead
        const newLeadId = await window.DatabaseService.createLead(leadData, this.currentUser.uid);
        
        // Add creation comment
        const creatorName = this.currentUser.displayName || this.currentUser.email;
        await window.DatabaseService.addComment(newLeadId, {
          content: `Lead created by ${creatorName}: ${leadData.companyName} - ${leadData.jobRole}`
        }, this.currentUser.uid);
        
        this.showToast('Lead added successfully!', 'success');
      }

      // Reset form and switch to add mode
      this.switchToAddMode();
      
      // Navigate to leads page after a short delay
      setTimeout(() => {
        this.showPage('leads');
      }, 1000);

    } catch (error) {
      console.error('Error handling lead:', error);
      this.showToast('Error: ' + error.message, 'error');
    } finally {
      submitButton.textContent = originalText;
      submitButton.disabled = false;
    }

    
  }

  // LEAD MODAL
  async openLeadModal(leadId) {
    this.currentLeadId = leadId;

    if(window.plmsApp.isEditingLead){
    
      try {
        const lead = await window.DatabaseService.getLead(leadId);
        if (!lead) {
          this.showToast('Lead not found', 'error');
          return;
        }

        const creator = await window.DatabaseService.getUser(lead.createdBy);
        const assignee = await window.DatabaseService.getUser(lead.assignedTo);
        const modal = document.getElementById('leadModal');

        // Populate lead details
        document.getElementById('modalLeadTitle').textContent = `${lead.companyName} - ${lead.jobRole}`;
        document.getElementById('modalCompany').textContent = lead.companyName;
        document.getElementById('modalJobRole').textContent = lead.jobRole;
        document.getElementById('modalContactPerson').textContent = lead.contactPerson;
        document.getElementById('modalEmail').textContent = lead.contactEmail;
        document.getElementById('modalPhone').textContent = lead.contactPhone || 'N/A';
        document.getElementById('modalSource').textContent = lead.source || 'N/A';
        document.getElementById('modalDescription').textContent = lead.description || 'No description provided';

        // 🆕 Created By (supports span or <select>)
        this.populateModalCreatedBy(lead, creator);
        this.populateModalAssignedTo(lead, assignee);

        document.getElementById('modalCreatedDate').textContent = this.formatDate(lead.createdAt);

        // Job description link
        const jobLinkElement = document.getElementById('modalJobLink');
        if (jobLinkElement) {
          if (lead.jobDescriptionLink) {
            jobLinkElement.innerHTML = `<a href="${lead.jobDescriptionLink}" target="_blank" rel="noopener noreferrer">${lead.jobDescriptionLink}</a>`;
          } else {
            jobLinkElement.textContent = 'N/A';
          }
        }

        // Status display/dropdown
        const statusSpan = document.getElementById('modalStatus');
        const statusDropdown = document.getElementById('statusDropdown');
        
        if (statusSpan) {
          statusSpan.textContent = lead.status;
          statusSpan.className = `status ${lead.status.toLowerCase().replace(/\s+/g, '-')}`;
        }

        if (this.userRole === 'admin' && statusDropdown) {
          statusDropdown.innerHTML = this.config.statuses.map(status => 
            `<option value="${status}" ${status === lead.status ? 'selected' : ''}>${status}</option>`
          ).join('');
          statusDropdown.style.display = 'inline-block';
          if (statusSpan) statusSpan.style.display = 'none';
        } else if (statusDropdown) {
          statusDropdown.style.display = 'none';
          if (statusSpan) statusSpan.style.display = 'inline-block';
        }

        // Tags
        const tagsContainer = document.getElementById('modalTags');
        if (tagsContainer) {
          tagsContainer.innerHTML = (lead.tags || []).map(tag => 
            `<span class="tag">${tag}</span>`
          ).join('') || '<span style="color: var(--color-text-secondary);">No tags</span>';
        }

        // Load comments and history
        this.loadLeadComments(leadId);
        this.loadStatusHistory(leadId);

        modal.classList.remove('hidden');
      } catch (error) {
        console.error('Error opening lead modal:', error);
        this.showToast('Error loading lead details', 'error');
      }
    }
  }

  updateActiveMentionItem(autocomplete, activeIndex) {
  const items = autocomplete.querySelectorAll('.mention-item');
  items.forEach((item, idx) => {
    if (idx === activeIndex) {
      item.classList.add('active');
      // Optionally scroll into view if overflowed
      item.scrollIntoView({ block: 'nearest' });
    } else {
      item.classList.remove('active');
    }
  });
}


setupMentionAutocomplete() {
    console.log('Setting up mention autocomplete...');
    
    const textarea = document.getElementById('commentText');
    const autocomplete = document.getElementById('mentionAutocomplete');
    
    console.log('Textarea found:', !!textarea);
    console.log('Autocomplete container found:', !!autocomplete);
    console.log('Users available:', this.users?.length || 0);
    
    if (!textarea || !autocomplete) {
        console.log('Mention elements not found, skipping setup');
        return;
    }
    
    if (!this.users || this.users.length === 0) {
        console.log('Users not loaded, mention autocomplete disabled');
        return;
    }

    // Rest of your existing mention code...
    let mentionStartIndex = -1;
    let filteredUsers = [];
    let activeIndex = 0;

    textarea.addEventListener('input', () => {
        console.log('Input detected:', textarea.value);
        
        const caretPos = textarea.selectionStart;
        const text = textarea.value;
        mentionStartIndex = text.lastIndexOf('@', caretPos - 1);

        if (mentionStartIndex === -1 || (mentionStartIndex > 0 && /\s/.test(text[mentionStartIndex - 1]))) {
            autocomplete.style.display = 'none';
            return;
        }

        const query = text.slice(mentionStartIndex + 1, caretPos).toLowerCase();
        console.log('Mention query:', query);
        
        if (query.length === 0) {
            autocomplete.style.display = 'none';
            return;
        }

        filteredUsers = this.users.filter(u =>
            u.name.toLowerCase().startsWith(query) || u.email.toLowerCase().startsWith(query)
        ).slice(0, 10);

        console.log('Filtered users:', filteredUsers.length);

        if (filteredUsers.length === 0) {
            autocomplete.style.display = 'none';
            return;
        }

        autocomplete.innerHTML = filteredUsers.map((user, idx) =>
            `<div class="mention-item ${idx === 0 ? 'active' : ''}" data-index="${idx}" data-id="${user.id}">
                ${user.name} &lt;${user.email}&gt;
            </div>`
        ).join('');

        autocomplete.style.display = 'block';
        activeIndex = 0;
    });

    // Rest of keyboard and click handlers remain the same...
    textarea.addEventListener('keydown', (e) => {
      if (autocomplete.style.display === 'block') {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          activeIndex = (activeIndex + 1) % filteredUsers.length;
          this.updateActiveMentionItem(autocomplete, activeIndex);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          activeIndex = (activeIndex - 1 + filteredUsers.length) % filteredUsers.length;
          this.updateActiveMentionItem(autocomplete, activeIndex);
        } else if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          this.selectMention(filteredUsers[activeIndex], textarea, mentionStartIndex, autocomplete);
        } else if (e.key === 'Escape') {
          autocomplete.style.display = 'none';
        }
      }
    });

    autocomplete.addEventListener('click', (e) => {
      if (e.target.classList.contains('mention-item')) {
        const idx = parseInt(e.target.dataset.index);
        this.selectMention(filteredUsers[idx], textarea, mentionStartIndex, autocomplete);
      }
    });
  }


  selectMention(user, textarea, mentionStartIndex, autocomplete) {
    const text = textarea.value;
    const beforeMention = text.slice(0, mentionStartIndex);
    const afterCaret = text.slice(textarea.selectionStart);

    const mentionText = `@${user.name.replace(/\s/g, "")} `;
    textarea.value = beforeMention + mentionText + afterCaret;

    const newCaretPos = (beforeMention + mentionText).length;
    textarea.setSelectionRange(newCaretPos, newCaretPos);

    autocomplete.style.display = "none";

    // Instead of sending notification here, add user id to a mentions set
    this.collectedMentions = this.collectedMentions || new Set();
    this.collectedMentions.add(user.id);
  }


  async sendMentionNotification(mentionedUserId) {
    const leadId = this.currentLeadId; // assumed context
    const lead_object = this.allLeads.find(l => l.id == this.currentLeadId);
    const companyName = lead_object ? lead_object.companyName : "";
    const message = `You were mentioned in a comment for ${companyName}`;

    await window.DatabaseService.sendNotification(
      mentionedUserId,
      leadId,
      "mention",
      message
    );
  }


  // 🆕 Populate modal "Created By" as a dropdown (if present) + update DB on change
  populateModalCreatedBy(lead, creator) {
    const createdByEl = document.getElementById('modalCreatedBy');
    if (!createdByEl) return;

    // If modal has a <select id="modalCreatedBy"> (preferred), render options
    if (createdByEl.tagName.toLowerCase() === 'select') {
      createdByEl.disabled = true;
      // Only admins can change creator. Members just see disabled select.
      const canEdit = this.userRole === 'admin';
      //createdByEl.disabled = !canEdit;

      // Build options from cached users
      const optionsHtml = this.users
        .map(u => `<option value="${u.id}" ${u.id === lead.createdBy ? 'selected' : ''}>${u.name || u.email || u.id}</option>`)
        .join('');

      createdByEl.innerHTML = optionsHtml || `<option value="${lead.createdBy}" selected>${creator?.name || creator?.email || lead.createdBy}</option>`;

      // Bind change -> update Firestore
      // Remove previous listener by cloning (simple safe pattern)
      const cloned = createdByEl.cloneNode(true);
      createdByEl.parentNode.replaceChild(cloned, createdByEl);

      if (canEdit) {
        cloned.addEventListener('change', async () => {
          const newCreatedBy = cloned.value;
          if (!newCreatedBy || newCreatedBy === lead.createdBy) return;
          try {
            await window.DatabaseService.updateLead(lead.id, { createdBy: newCreatedBy });
            this.showToast('Created By updated successfully', 'success');
          } catch (err) {
            console.error('Error updating Created By:', err);
            this.showToast('Failed to update Created By', 'error');
          }
        });
      }
    } else {
      // Backward-compatible: if it's a <span>, just show the name
      createdByEl.textContent = creator ? (creator.name || creator.email || 'Unknown') : 'Unknown';
    }
  }

  populateModalAssignedTo(lead, creator) {
    const createdByEl1 = document.getElementById('modalAssignedTo');
    //if (!createdByEl1) return;
    const existing = lead.assignedTo;
    // If modal has a <select id="modalCreatedBy"> (preferred), render options
    if (createdByEl1.tagName.toLowerCase() === 'select') {
      // Only admins can change creator. Members just see disabled select.
      const canEdit = this.userRole === 'admin';
      createdByEl1.disabled = !canEdit;

      // Build options from cached users
      const optionsHtml = this.users
        .map(u => `<option value="${u.id}" ${u.id === lead.assignedTo ? 'selected' : ''}>${u.name || u.email || u.id}</option>`)
        .join('');

      createdByEl1.innerHTML = optionsHtml || `<option value="${lead.assignedTo}" selected>${creator?.name || creator?.email || lead.assignedTo}</option>`;

      // Bind change -> update Firestore
      // Remove previous listener by cloning (simple safe pattern)
      const cloned = createdByEl1.cloneNode(true);
      createdByEl1.parentNode.replaceChild(cloned, createdByEl1);

      if (canEdit) {
        cloned.addEventListener('change', async () => {
          const newCreatedBy1 = cloned.value;
          if (!newCreatedBy1 || newCreatedBy1 === lead.assignedTo) return;
          try {
            await window.DatabaseService.updateLead(lead.id, { assignedTo: newCreatedBy1 });
            this.showToast('Assignee updated successfully', 'success');
              const oldUser = this.users.find(u => u.id === existing);
            const newUser = this.users.find(u => u.id === newCreatedBy1);
            await window.DatabaseService.addComment(lead.id, {
              content: `Assignee changed from "${oldUser?.name || oldUser?.email || oldAssignee}" to "${newUser?.name || newUser?.email || newAssignee}"`
            }, this.currentUser.uid);

            await window.DatabaseService.sendNotification(newCreatedBy1,lead.id,"assigned",`You have been assigned to Lead: ${lead.companyName || ''}`,null);
      
          } catch (err) {
            console.error('Error updating Assignee:', err);
            this.showToast('Failed to update Assignee', 'error');
          }
        });
      }
    } else {
      // Backward-compatible: if it's a <span>, just show the name
      createdByEl1.textContent = creator ? (creator.name || creator.email || 'Unknown') : 'Unknown';
    }
  }
  closeLeadModal() {
    const modal = document.getElementById('leadModal');
    if (modal) {
      modal.classList.add('hidden');
    }
    this.currentLeadId = null;
    
    // Clean up modal subscriptions
    this.cleanupModalSubscriptions();
  }

  async updateLeadStatus() {
    if (this.userRole !== 'admin' || !this.currentLeadId) return;

    const statusDropdown = document.getElementById('statusDropdown');
    if (!statusDropdown) return;

    const newStatus = statusDropdown.value;
    const lead = await window.DatabaseService.getLead(this.currentLeadId);
    
    if (!lead || lead.status === newStatus) return;

    try {
      await window.DatabaseService.updateLeadStatus(
        this.currentLeadId, 
        lead.status, 
        newStatus, 
        this.currentUser.uid,
        `Status updated by ${this.currentUser.displayName || this.currentUser.email}`
      );

      this.showToast(`Status updated to ${newStatus}`, 'success');

        await window.DatabaseService.addComment(this.currentLeadId, {
          content: `${this.currentUser.displayName || this.currentUser.email} updated status to "${newStatus}"`
        }, this.currentUser.uid);


      // Update status display
      const statusSpan = document.getElementById('modalStatus');
      if (statusSpan) {
        statusSpan.textContent = newStatus;
        statusSpan.className = `status ${newStatus.toLowerCase().replace(/\s+/g, '-')}`;
      }
    } catch (error) {
      console.error('Error updating lead status:', error);
      this.showToast('Error updating status', 'error');
    }
  }

  loadLeadComments(leadId) {
    const unsubscribe = window.DatabaseService.onCommentsSnapshot(leadId, async (comments) => {
      const container = document.getElementById('commentsContainer');
      if (!container) return;

      if (comments.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--color-text-secondary); padding: 1rem;">No comments yet.</p>';
        return;
      }

      const commentsWithUsers = await Promise.all(
        comments.map(async (comment) => {
          const user = await window.DatabaseService.getUser(comment.userId);
          return { ...comment, user };
        })
      );

      container.innerHTML = commentsWithUsers.map(comment => `
        <div class="comment-item ${comment.isAdminPinned ? 'pinned' : ''}">
          <img src="${comment.user?.avatar || ''}" alt="${comment.user?.name || 'Unknown'}" class="comment-avatar">
          <div class="comment-content">
            <div class="comment-header">
              <span class="comment-author">${comment.user?.name || 'Unknown'}</span>
              <span class="comment-time">${this.formatTimeAgo(comment.createdAt)}</span>
            </div>
            <div class="comment-text">${comment.content}</div>
            ${comment.isAdminPinned ? '<small style="color: var(--color-warning);">📌 Pinned by Admin</small>' : ''}
          </div>
        </div>
      `).join('');
    });
    
    this.modalUnsubscribeFunctions = this.modalUnsubscribeFunctions || [];
    this.modalUnsubscribeFunctions.push(unsubscribe);
  }

  loadStatusHistory(leadId) {
    const unsubscribe = window.DatabaseService.onStatusHistorySnapshot(leadId, async (history) => {
      const container = document.getElementById('statusHistoryContainer');
      if (!container) return;

      if (history.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--color-text-secondary); padding: 1rem;">No status changes yet.</p>';
        return;
      }

      const historyWithUsers = await Promise.all(
        history.map(async (item) => {
          const user = await window.DatabaseService.getUser(item.changedBy);
          return { ...item, user };
        })
      );

      container.innerHTML = historyWithUsers.map(item => `
        <div class="history-item">
          <div class="history-icon">→</div>
          <div class="history-content">
            <div class="history-text">
              Changed from <strong>${item.fromStatus}</strong> to <strong>${item.toStatus}</strong>
              by ${item.user?.name || 'Unknown'}
            </div>
            <div class="history-time">${this.formatTimeAgo(item.changedAt)}</div>
            ${item.notes ? `<div class="history-notes">${item.notes}</div>` : ''}
          </div>
        </div>
      `).join('');
    });
    
    this.modalUnsubscribeFunctions = this.modalUnsubscribeFunctions || [];
    this.modalUnsubscribeFunctions.push(unsubscribe);
  }

  async handleAddComment(e) {
    e.preventDefault();
    
    if (!this.currentLeadId || !this.currentUser) return;

    const commentText = document.getElementById('commentText');
    const content = commentText.value.trim();
    
    if (!content) {
      this.showToast('Please enter a comment', 'error');
      return;
    }

    const submitButton = e.target.querySelector('button[type="submit"]');
    const originalText = submitButton.textContent;
    
    try {
      submitButton.textContent = 'Adding...';
      submitButton.disabled = true;

      await window.DatabaseService.addComment(this.currentLeadId, {
        content: content
      }, this.currentUser.uid);

      commentText.value = '';
      this.showToast('Comment added successfully!', 'success');

      // After successfully adding comment, send notifications to all mentioned users
      const mentionsToNotify = this.collectedMentions || new Set();
      for (const userId of mentionsToNotify) {
        await this.sendMentionNotification(userId);
      }

      // Clear collected mentions for next comment
      this.collectedMentions = new Set();

    } catch (error) {
      console.error('Error adding comment:', error);
      this.showToast('Error adding comment', 'error');
    } finally {
      submitButton.textContent = originalText;
      submitButton.disabled = false;
    }
  }

  // FILTERS
  setupFilters() {
    if (!this.config) return;

    // Populate status filter
    const statusFilter = document.getElementById('statusFilter');
    if (statusFilter) {
      statusFilter.innerHTML = '<option value="">All Statuses</option>' +
        this.config.statuses.map(status => 
          `<option value="${status}">${status}</option>`
        ).join('');
    }

    // Populate tag filter
    const tagFilter = document.getElementById('tagFilter');
    if (tagFilter) {
      tagFilter.innerHTML = '<option value="">All Tags</option>' +
        this.config.tags.map(tag => 
          `<option value="${tag}">${tag}</option>`
        ).join('');
    }

    // Populate users for created by filter
    this.loadUsersForFilter();
  }

  async loadUsersForFilter() {
    try {
      const unsubscribe = window.DatabaseService.onUsersSnapshot((users) => {
        // 🆕 keep a global cache
        this.users = users || [];
        this.usersById = {};
        for (const u of this.users) {
          this.usersById[u.id] = u;
        }

        const createdByFilter = document.getElementById('createdByFilter');
        if (createdByFilter) {
          createdByFilter.innerHTML = '<option value="">All Users</option>' +
            this.users.map(user => 
              `<option value="${user.id}">${user.name || user.email || user.id}</option>`
            ).join('');
        }

        const assignedToFilter = document.getElementById('assignedToFilter');
        if (assignedToFilter) {
          assignedToFilter.innerHTML = '<option value="">All Users</option>' +
            this.users.map(user => 
              `<option value="${user.id}">${user.name || user.email || user.id}</option>`
            ).join('');
        }
      });
      
      
      this.unsubscribeFunctions.push(unsubscribe);
    } catch (error) {
      console.error('Error loading users for filter:', error);
    }
  }

  // ADMIN PANEL
  async loadAdminPanel() {
    if (this.userRole !== 'admin') return;

    this.loadUsersTable();
    this.loadAdminStats();

    // Load email template
    const template = await window.DatabaseService.getEmailTemplate();

    document.getElementById('emailSubject').value = template?.subject || '';
    document.getElementById('emailBody').value = template?.body || '';
    document.getElementById('emailSignature').value = template?.signature || '';

    // Bind form save event (only once)
    const form = document.getElementById('emailTemplateForm');
    if (form && !form.dataset.bound) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const templateData = {
          subject: document.getElementById('emailSubject').value,
          body: document.getElementById('emailBody').value,
          signature: document.getElementById('emailSignature').value
        };
        await window.DatabaseService.saveEmailTemplate(templateData);
        this.showToast('Email template updated successfully!', 'success');
      });
      form.dataset.bound = "true"; // prevent duplicate binding
    }
  }

  loadUsersTable() {
    const unsubscribe = window.DatabaseService.onUsersSnapshot((users) => {
      const container = document.getElementById('usersTable');
      if (!container) return;

      container.innerHTML = `
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Join Date</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${users.map(user => `
              <tr>
                <td>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <img src="${user.avatar || ''}" alt="${user.name}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover;">
                    ${user.name}
                  </div>
                </td>
                <td>${user.email}</td>
                <td>
                  <select onchange="updateUserRole('${user.id}', this.value)" ${user.id === this.currentUser?.uid ? 'disabled' : ''}>
                    <option value="member" ${user.role === 'member' ? 'selected' : ''}>Member</option>
                    <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
                  </select>
                </td>
                <td>${this.formatDate(user.joinDate)}</td>
                <td><span class="status status--${user.isActive ? 'success' : 'error'}">${user.isActive ? 'Active' : 'Inactive'}</span></td>
                <td>
                  <button class="btn btn--sm btn--outline" onclick="toggleUserStatus('${user.id}', ${!user.isActive})" ${user.id === this.currentUser?.uid ? 'disabled' : ''}>
                    ${user.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    });
    
    this.unsubscribeFunctions.push(unsubscribe);
  }

  async loadAdminStats() {
    try {
      const analytics = await window.DatabaseService.getAnalytics();
      
      const container = document.getElementById('adminStats');
      if (container) {
        container.innerHTML = `
          <div class="admin-stat">
            <span class="stat-label">Total Users:</span>
            <span class="stat-value">${analytics.totalUsers}</span>
          </div>
          <div class="admin-stat">
            <span class="stat-label">Active Users:</span>
            <span class="stat-value">${analytics.activeUsers}</span>
          </div>
          <div class="admin-stat">
            <span class="stat-label">Total Leads:</span>
            <span class="stat-value">${analytics.totalLeads}</span>
          </div>
          <div class="admin-stat">
            <span class="stat-label">Pending Review:</span>
            <span class="stat-value">${analytics.statusDistribution['New'] || 0}</span>
          </div>
        `;
      }
    } catch (error) {
      console.error('Error loading admin stats:', error);
    }
  }

  // UTILITY METHODS
  formatDate(timestamp) {
    if (!timestamp) return 'Unknown';
    
    try {
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch (error) {
      return 'Invalid Date';
    }
  }

  formatTimeAgo(timestamp) {
    if (!timestamp) return 'Unknown';
    
    try {
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      const now = new Date();
      const diffInSeconds = Math.floor((now - date) / 1000);

      if (diffInSeconds < 60) return 'Just now';
      if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
      if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
      return `${Math.floor(diffInSeconds / 86400)}d ago`;
    } catch (error) {
      return 'Unknown';
    }
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <div class="toast-message">${message}</div>
      <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
    `;

    container.appendChild(toast);

    // Auto remove after 5 seconds
    setTimeout(() => {
      if (toast.parentElement) {
        toast.remove();
      }
    }, 5000);
  }

  cleanupSubscriptions() {
    this.unsubscribeFunctions.forEach(unsubscribe => {
      try {
        unsubscribe();
      } catch (error) {
        console.error('Error unsubscribing:', error);
      }
    });
    this.unsubscribeFunctions = [];
  }

  cleanupModalSubscriptions() {
    if (this.modalUnsubscribeFunctions) {
      this.modalUnsubscribeFunctions.forEach(unsubscribe => {
        try {
          unsubscribe();
        } catch (error) {
          console.error('Error unsubscribing modal:', error);
        }
      });
      this.modalUnsubscribeFunctions = [];
    }
  }

  destroy() {
    this.cleanupSubscriptions();
    this.cleanupModalSubscriptions();
    
    if (this.authUnsubscribe) {
      this.authUnsubscribe();
    }
  }
}

// Global functions for HTML onclick handlers
function showPage(page) {
  if (window.plmsApp) {
    window.plmsApp.showPage(page);
  }
}

function handleLogout() {
  if (window.plmsApp) {
    window.plmsApp.handleLogout();
  }
}

function openLeadModal(leadId) {
  if (window.plmsApp) {
    window.plmsApp.openLeadModal(leadId);
  }
}

function closeLeadModal() {
  if (window.plmsApp) {
    window.plmsApp.closeLeadModal();
  }
}

// 🆕 Update Global clearAddLeadForm Function
function clearAddLeadForm() {
  if (window.plmsApp) {
    window.plmsApp.switchToAddMode();
  }
}

// Admin functions
async function updateUserRole(userId, newRole) {
  try {
    await window.DatabaseService.updateUserRole(userId, newRole);
    window.plmsApp.showToast(`User role updated to ${newRole}`, 'success');
  } catch (error) {
    console.error('Error updating user role:', error);
    window.plmsApp.showToast('Error updating user role', 'error');
  }
}

async function toggleUserStatus(userId, isActive) {
  try {
    await window.DatabaseService.updateUser(userId, { isActive });
    window.plmsApp.showToast(`User ${isActive ? 'activated' : 'deactivated'}`, 'success');
  } catch (error) {
    console.error('Error updating user status:', error);
    window.plmsApp.showToast('Error updating user status', 'error');
  }
}

// === Theme Toggle Controller ===
(function () {
  const KEY = 'plms-theme'; // 'system' | 'light' | 'dark'
  const root = document.documentElement;

  function applyTheme(mode) {
    if (mode === 'dark') {
      root.setAttribute('data-color-scheme', 'dark');
    } else if (mode === 'light') {
      root.setAttribute('data-color-scheme', 'light');
    } else {
      // system (fallback to prefers-color-scheme)
      root.removeAttribute('data-color-scheme');
    }
  }

  window.toggleTheme = function () {
    const cur = localStorage.getItem(KEY) || 'system';
    const next = cur === 'system' ? 'light' : cur === 'light' ? 'dark' : 'system';
    localStorage.setItem(KEY, next);
    applyTheme(next);

    const btn = document.getElementById('themeToggle');
    if (btn) btn.setAttribute('data-mode', next);
  };

  // On load: use saved preference or fallback
  const saved = localStorage.getItem(KEY) || 'system';
  applyTheme(saved);
})();

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded, initializing Firebase PLMS (No Storage)...');
  window.plmsApp = new PlacementLeadSystem();

  // Attach theme toggle listener cleanly
  const btn = document.getElementById('themeToggle');
  if (btn) {
    btn.addEventListener('click', () => window.toggleTheme());
  }
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (window.plmsApp) {
    window.plmsApp.destroy();
  }
});