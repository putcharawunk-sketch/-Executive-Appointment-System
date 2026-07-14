/**
 * Executive Appointment Manager - Hash-based View Router
 */

export class HashRouter {
  /**
   * Creates a HashRouter instance
   * @param {Object} routeConfig - Map of route names (e.g. 'home', 'success') to HTML container selector strings/callbacks
   * @param {string} defaultHash - Default hash fallback if no hash or invalid hash is present
   */
  constructor(routeConfig, defaultHash) {
    this.routes = routeConfig;
    this.defaultHash = defaultHash || Object.keys(routeConfig)[0];
    this.currentHash = '';
    
    // Bind change listener
    window.addEventListener('hashchange', () => this.handleRouting());
  }

  /**
   * Safely initializes the router and triggers the initial page load
   */
  init() {
    this.handleRouting();
  }

  /**
   * Directs traffic to the correct visual containers or custom triggers
   */
  handleRouting() {
    let rawHash = window.location.hash.slice(1) || this.defaultHash;
    
    // Parse query params if any (e.g. #status?code=EXE-123456)
    let params = {};
    if (rawHash.includes('?')) {
      const parts = rawHash.split('?');
      rawHash = parts[0];
      const queryStr = parts[1];
      const urlParams = new URLSearchParams(queryStr);
      for (const [key, value] of urlParams.entries()) {
        params[key] = value;
      }
    }

    const matchedRoute = this.routes[rawHash];
    
    if (matchedRoute) {
      this.currentHash = rawHash;
      
      // Update UI Views
      this._updateUIViews(rawHash);
      
      // Execute optional callback registered to the route
      if (typeof matchedRoute === 'function') {
        matchedRoute(params);
      }
    } else {
      // Keep within bounds of registered routes
      window.location.hash = this.defaultHash;
    }
  }

  /**
   * Internal helper to hide non-active views and present the active view
   */
  _updateUIViews(activeHash) {
    // Collect all elements that have been marked for router control
    const routerViews = document.querySelectorAll('[data-route-view]');
    
    routerViews.forEach((view) => {
      const matchingRoute = view.getAttribute('data-route-view');
      
      if (matchingRoute === activeHash) {
        // Show with gorgeous fade-in
        view.classList.remove('hidden');
        view.classList.add('animate-fade-in');
      } else {
        // Hide
        view.classList.add('hidden');
        view.classList.remove('animate-fade-in');
      }
    });

    // Also update any navigation link active indicators
    const routerLinks = document.querySelectorAll('[data-route-link]');
    routerLinks.forEach((link) => {
      const targetRoute = link.getAttribute('data-route-link');
      if (targetRoute === activeHash) {
        link.classList.add('border-primary', 'text-primary');
        link.classList.remove('text-gray-400');
      } else {
        link.classList.remove('border-primary', 'text-primary');
        link.classList.add('text-gray-400');
      }
    });
  }

  /**
   * Programmatically change route
   * @param {string} hashName - Destination route without hash character 
   * @param {Object} queryParams - Optional query params to append
   */
  navigate(hashName, queryParams = null) {
    let target = hashName;
    if (queryParams) {
      const q = new URLSearchParams(queryParams);
      target += `?${q.toString()}`;
    }
    window.location.hash = target;
  }
}
