// Authentication Service
class AuthService {
  constructor() {
    this.auth = window.firebaseApp.auth;
    this.db = window.firebaseApp.db;
    this.currentUser = null;
    this.userRole = null;
    this.authStateChangeListeners = [];
  }

  // Register new user
  async register(email, password, displayName) {
    try {
      const credential = await this.auth.createUserWithEmailAndPassword(email, password);
      
      // Update user profile
      await credential.user.updateProfile({
        displayName: displayName
      });

      // Create user document in Firestore
      await this.db.collection('users').doc(credential.user.uid).set({
        uid: credential.user.uid,
        name: displayName,
        email: email,
        role: 'member', // Default role
        avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=2563EB&color=fff`,
        joinDate: window.firebaseApp.serverTimestamp(),
        isActive: false,
        createdAt: window.firebaseApp.serverTimestamp(),
        updatedAt: window.firebaseApp.serverTimestamp()
      });

      return credential.user;
    } catch (error) {
      console.error('Registration error:', error);
      throw error;
    }
  }

  // Login user
  async login(email, password) {
    try {
      const credential = await this.auth.signInWithEmailAndPassword(email, password);
      return credential.user;
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  }

  // Logout user
  async logout() {
    try {
      await this.auth.signOut();
      this.currentUser = null;
      this.userRole = null;
    } catch (error) {
      console.error('Logout error:', error);
      throw error;
    }
  }

  // Get current user
  getCurrentUser() {
    return this.auth.currentUser;
  }

  // Get user role from Firestore
  async getUserRole(user) {
    if (!user) return null;
    
    try {
      const userDoc = await this.db.collection('users').doc(user.uid).get();
      if (userDoc.exists) {
        return userDoc.data().role || 'member';
      }
      return 'member';
    } catch (error) {
      console.error('Error getting user role:', error);
      return 'member';
    }
  }

  // Get user data from Firestore
  async getUserData(user) {
    if (!user) return null;
    
    try {
      const userDoc = await this.db.collection('users').doc(user.uid).get();
      if (userDoc.exists) {
        return userDoc.data();
      }
      return null;
    } catch (error) {
      console.error('Error getting user data:', error);
      return null;
    }
  }

  // Listen to auth state changes
  onAuthStateChanged(callback) {
    return this.auth.onAuthStateChanged(async (user) => {
      this.currentUser = user;
      if (user) {
        this.userRole = await this.getUserRole(user);
      } else {
        this.userRole = null;
      }
      callback(user, this.userRole);
    });
  }
  // Listen to auth state changes
/*onAuthStateChanged(callback) {
  return this.auth.onAuthStateChanged(async (user) => {
    if (user) {
      const userDoc = await this.db.collection('users').doc(user.uid).get();
      if (!userDoc.exists || userDoc.data().isActive === false) {
        // 🚫 Kick out inactive users immediately
        await this.auth.signOut();
        this.currentUser = null;
        this.userRole = null;
        callback(null, null); // notify app that user is not allowed
        //return;
      }

      this.currentUser = user;
      this.userRole = userDoc.data().role || 'member';
      callback(user, this.userRole);
    } else {
      this.currentUser = null;
      this.userRole = null;
      callback(null, null);
    }
  });
}*/


  // Check if user is admin
  isAdmin() {
    return this.userRole === 'admin';
  }

  // Send password reset email
  async sendPasswordResetEmail(email) {
    try {
      await this.auth.sendPasswordResetEmail(email);
    } catch (error) {
      console.error('Password reset error:', error);
      throw error;
    }
  }
}

// Export auth service
window.AuthService = new AuthService();
