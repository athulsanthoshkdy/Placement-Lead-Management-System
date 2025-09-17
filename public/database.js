// Database Service - No Storage Version
class DatabaseService {
  constructor() {
    this.db = window.firebaseApp.db;
    this.serverTimestamp = window.firebaseApp.serverTimestamp;
  }

  // LEADS OPERATIONS
  async createLead(leadData, userId) {
    try {
      const lead = {
        ...leadData,
        status: 'New',
        createdBy: userId,
        assignedTo: userId,
        createdAt: this.serverTimestamp(),
        updatedAt: this.serverTimestamp()
      };

      const docRef = await this.db.collection('leads').add(lead);
/*
      // Get user name
      let creatorName = "Unknown User";
      const creator = await this.getUser(userId);
      if (creator) {
        creatorName = creator.name || creator.email || userId;
      }

      // ✅ Add system comment with name
      await this.db.collection('leads').doc(docRef.id)
      .collection('comments').add({
        content: `Lead created by ${creatorName}`,   // ✅ match normal comments
        userId: userId,
        createdAt: this.serverTimestamp(),
        isAdminPinned: false
      });*/

          // ✅ Log under userLeadsMap/{userId}/leads/{leadId}
    await this.db.collection('userLeadsMap')
      .doc(userId)
      .collection('leads')
      .doc(docRef.id)
      .set({
        leadId: docRef.id,
        createdAt: this.serverTimestamp()
      });


      return docRef.id;
    } catch (error) {
      console.error('Error creating lead:', error);
      throw error;
    }
  }

  async updateLead(leadId, updateData) {
    try {
      await this.db.collection('leads').doc(leadId).update({
        ...updateData,
        updatedAt: this.serverTimestamp()
      });
    } catch (error) {
      console.error('Error updating lead:', error);
      throw error;
    }
  }

  async updateLeadStatus(leadId, fromStatus, toStatus, userId, notes = '') {
    try {
      const batch = this.db.batch();

      // Update lead status
      const leadRef = this.db.collection('leads').doc(leadId);
      batch.update(leadRef, {
        status: toStatus,
        updatedAt: this.serverTimestamp()
      });

      // Add status history
      const historyRef = this.db.collection('leads').doc(leadId)
        .collection('statusHistory').doc();
      batch.set(historyRef, {
        fromStatus: fromStatus,
        toStatus: toStatus,
        changedBy: userId,
        changedAt: this.serverTimestamp(),
        notes: notes
      });

      await batch.commit();
    } catch (error) {
      console.error('Error updating lead status:', error);
      throw error;
    }
  }

  async deleteLead(leadId) {
    try {
      await this.db.collection('leads').doc(leadId).delete();
    } catch (error) {
      console.error('Error deleting lead:', error);
      throw error;
    }
  }

  // Get leads with real-time updates
  onLeadsSnapshot(callback, filters = {}) {
    let query = this.db.collection('leads')
      .orderBy('updatedAt', 'desc');

    // Apply filters
    if (filters.status) {
      query = query.where('status', '==', filters.status);
    }
    if (filters.createdBy) {
      query = query.where('createdBy', '==', filters.createdBy);
    }
    if (filters.tags && filters.tags.length > 0) {
      query = query.where('tags', 'array-contains-any', filters.tags);
    }

    return query.onSnapshot((snapshot) => {
      const leads = [];
      snapshot.forEach((doc) => {
        leads.push({
          id: doc.id,
          ...doc.data()
        });
      });
      callback(leads);
    });
  }

  async getLead(leadId) {
    try {
      const doc = await this.db.collection('leads').doc(leadId).get();
      if (doc.exists) {
        return {
          id: doc.id,
          ...doc.data()
        };
      }
      return null;
    } catch (error) {
      console.error('Error getting lead:', error);
      throw error;
    }
  }

  // Listen to single lead changes
  onLeadSnapshot(leadId, callback) {
    return this.db.collection('leads').doc(leadId)
      .onSnapshot((doc) => {
        if (doc.exists) {
          callback({
            id: doc.id,
            ...doc.data()
          });
        } else {
          callback(null);
        }
      });
  }

  // COMMENTS OPERATIONS
  async addComment(leadId, commentData, userId) {
    try {
      const comment = {
        ...commentData,
        userId: userId,
        createdAt: this.serverTimestamp(),
        isAdminPinned: false
      };

      const docRef = await this.db.collection('leads').doc(leadId)
        .collection('comments').add(comment);
      return docRef.id;
    } catch (error) {
      console.error('Error adding comment:', error);
      throw error;
    }
  }

  async pinComment(leadId, commentId, isPinned) {
    try {
      await this.db.collection('leads').doc(leadId)
        .collection('comments').doc(commentId)
        .update({
          isAdminPinned: isPinned,
          updatedAt: this.serverTimestamp()
        });
    } catch (error) {
      console.error('Error pinning comment:', error);
      throw error;
    }
  }

  async  sendNotification(toUserId, leadId, type, message, taskId) {
    await db.collection("notifications").add({
      toUserId,
      type,
      leadId,
      taskId: taskId || null,
      message,
      isRead: false,
      createdAt: this.serverTimestamp()
    });
  }

  onUserNotificationsSnapshot(userId, callback) {
    return this.db.collection("notifications")
      .where("toUserId", "==", userId)
      .orderBy("createdAt", "desc")
      .onSnapshot(snapshot => {
        const notifications = [];
        snapshot.forEach(doc => notifications.push({ id: doc.id, ...doc.data() }));
        callback(notifications);
      });
  }
  async markNotificationAsRead(notificationId) {
    await this.db.collection("notifications").doc(notificationId).update({ isRead: true });
  }

  // Listen to comments changes
  onCommentsSnapshot(leadId, callback) {
    return this.db.collection('leads').doc(leadId)
      .collection('comments')
      .orderBy('createdAt', 'desc')
      .onSnapshot((snapshot) => {
        const comments = [];
        snapshot.forEach((doc) => {
          comments.push({
            id: doc.id,
            ...doc.data()
          });
        });
        callback(comments);
      });
  }

  // STATUS HISTORY OPERATIONS
  onStatusHistorySnapshot(leadId, callback) {
    return this.db.collection('leads').doc(leadId)
      .collection('statusHistory')
      .orderBy('changedAt', 'desc')
      .onSnapshot((snapshot) => {
        const history = [];
        snapshot.forEach((doc) => {
          history.push({
            id: doc.id,
            ...doc.data()
          });
        });
        callback(history);
      });
  }

  // USERS OPERATIONS
  async getUser(userId) {
    try {
      const doc = await this.db.collection('users').doc(userId).get();
      if (doc.exists) {
        return {
          id: doc.id,
          ...doc.data()
        };
      }
      return null;
    } catch (error) {
      console.error('Error getting user:', error);
      throw error;
    }
  }

  async updateUser(userId, updateData) {
    try {
      await this.db.collection('users').doc(userId).update({
        ...updateData,
        updatedAt: this.serverTimestamp()
      });
    } catch (error) {
      console.error('Error updating user:', error);
      throw error;
    }
  }

  async updateUserRole(userId, role) {
    try {
      await this.db.collection('users').doc(userId).update({
        role: role,
        updatedAt: this.serverTimestamp()
      });
    } catch (error) {
      console.error('Error updating user role:', error);
      throw error;
    }
  }

  // Listen to all users (for admin)
  onUsersSnapshot(callback) {
    return this.db.collection('users')
      .orderBy('joinDate', 'desc')
      .onSnapshot((snapshot) => {
        const users = [];
        snapshot.forEach((doc) => {
          users.push({
            id: doc.id,
            ...doc.data()
          });
        });
        callback(users);
      });
  }

  // CONFIGURATION
  getConfig() {
    return {
      statuses: ['New', 'Under Review', 'On Hold','Shared with Faculty In-charge', 'Shared with CCD','Contacted', 'Replied','Placement Initiated', 'Interviewing', 'Closed', 'Rejected'],
      sources: ['LinkedIn', 'Website', 'Referral', 'Campus Drive', 'Cold Outreach', 'Job Board'],
      tags: ['Full-time', 'Internship', 'Part-time', 'Tech', 'Non-Tech', 'MNC', 'Startup', 'Service', 'Product', 'Consulting', 'Fintech', 'EdTech', 'Strategy', 'Analytics', 'Finance', 'HR', 'Marketing', 'Operations']
    };
  }

  // ANALYTICS
  async getAnalytics() {
    try {
      const leadsSnapshot = await this.db.collection('leads').get();
      const usersSnapshot = await this.db.collection('users').get();

      const leads = [];
      leadsSnapshot.forEach(doc => {
        leads.push({ id: doc.id, ...doc.data() });
      });

      const users = [];
      usersSnapshot.forEach(doc => {
        users.push({ id: doc.id, ...doc.data() });
      });

      return {
        totalLeads: leads.length,
        activeLeads: leads.filter(lead => !['Closed', 'Rejected'].includes(lead.status)).length,
        closedLeads: leads.filter(lead => lead.status === 'Closed').length,
        totalUsers: users.length,
        activeUsers: users.filter(user => user.isActive).length,
        statusDistribution: this.getStatusDistribution(leads),
        monthlyTrends: this.getMonthlyTrends(leads),
        dailyTrends: this.getDailyTrends(leads),
        weeklyTrends: this.getWeeklyTrends(leads),
        leads
      };
    } catch (error) {
      console.error('Error getting analytics:', error);
      throw error;
    }
  }

    // EMAIL TEMPLATE OPERATIONS
  async saveEmailTemplate(templateData) {
    try {
      await this.db.collection('settings').doc('emailTemplate').set({
        ...templateData,
        updatedAt: this.serverTimestamp()
      });
    } catch (error) {
      console.error('Error saving email template:', error);
      throw error;
    }
  }

  async getEmailTemplate() {
    try {
      const doc = await this.db.collection('settings').doc('emailTemplate').get();
      if (doc.exists) {
        return doc.data();
      }
      return null;
    } catch (error) {
      console.error('Error fetching email template:', error);
      throw error;
    }
  }


  getStatusDistribution(leads) {
    const distribution = {};
    const statuses = this.getConfig().statuses;
    
    statuses.forEach(status => {
      distribution[status] = leads.filter(lead => lead.status === status).length;
    });
    
    return distribution;
  }

  getMonthlyTrends(leads) {
    const trends = {};
    
    leads.forEach(lead => {
      if (lead.createdAt && lead.createdAt.toDate) {
        const date = lead.createdAt.toDate();
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        trends[monthKey] = (trends[monthKey] || 0) + 1;
      }
    });
    
    return trends;
  }

getDailyTrends(leads) {
  const trends = {};

  leads.forEach(lead => {
    if (lead.createdAt && lead.createdAt.toDate) {
      const date = lead.createdAt.toDate();
      const dayKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
      trends[dayKey] = (trends[dayKey] || 0) + 1;
    }
  });

  return trends;
}

getWeeklyTrends(leads) {
  const trends = {};

  leads.forEach(lead => {
    if (lead.createdAt && lead.createdAt.toDate) {
      const date = lead.createdAt.toDate();

      // Get ISO week number
      const tempDate = new Date(date.getTime());
      tempDate.setHours(0, 0, 0, 0);
      // Thursday in current week decides the year.
      tempDate.setDate(tempDate.getDate() + 3 - ((tempDate.getDay() + 6) % 7));
      const week1 = new Date(tempDate.getFullYear(), 0, 4);
      const weekNo = 1 + Math.round(
        ((tempDate.getTime() - week1.getTime()) / 86400000
        - 3 + ((week1.getDay() + 6) % 7)) / 7
      );

      const weekKey = `${tempDate.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
      trends[weekKey] = (trends[weekKey] || 0) + 1;
    }
  });

  return trends;
}

/*async updateLead(leadId, updates) {
  try {
    await this.db.collection('leads').doc(leadId).update(updates);
  } catch (error) {
    console.error('Error updating lead:', error);
    throw error;
  }
}*/




  // ACTIVITY FEED
  async getRecentActivity(limit = 10) {
    try {
      const activities = [];

      // Get recent comments
      const commentsQuery = this.db.collectionGroup('comments')
        .orderBy('createdAt', 'desc')
        .limit(limit);
      
      const commentsSnapshot = await commentsQuery.get();
      for (const doc of commentsSnapshot.docs) {
        const commentData = doc.data();
        const leadDoc = await this.db.collection('leads').doc(doc.ref.parent.parent.id).get();
        const userDoc = await this.db.collection('users').doc(commentData.userId).get();
        
        if (leadDoc.exists && userDoc.exists) {
          activities.push({
            type: 'comment',
            user: userDoc.data(),
            lead: leadDoc.data(),
            content: `commented on ${leadDoc.data().companyName} lead`,
            timestamp: commentData.createdAt
          });
        }
      }

      // Get recent status changes
      const historyQuery = this.db.collectionGroup('statusHistory')
        .orderBy('changedAt', 'desc')
        .limit(limit);
      
      const historySnapshot = await historyQuery.get();
      for (const doc of historySnapshot.docs) {
        const historyData = doc.data();
        const leadDoc = await this.db.collection('leads').doc(doc.ref.parent.parent.id).get();
        const userDoc = await this.db.collection('users').doc(historyData.changedBy).get();
        
        if (leadDoc.exists && userDoc.exists) {
          activities.push({
            type: 'status_change',
            user: userDoc.data(),
            lead: leadDoc.data(),
            content: `updated ${leadDoc.data().companyName} status to ${historyData.toStatus}`,
            timestamp: historyData.changedAt
          });
        }
      }

      // Sort by timestamp and return limited results
      activities.sort((a, b) => {
        const aTime = a.timestamp?.toDate ? a.timestamp.toDate() : new Date(a.timestamp);
        const bTime = b.timestamp?.toDate ? b.timestamp.toDate() : new Date(b.timestamp);
        return bTime - aTime;
      });

      return activities.slice(0, limit);
    } catch (error) {
      console.error('Error getting recent activity:', error);
      throw error;
    }
  }
}

// Export database service
window.DatabaseService = new DatabaseService();