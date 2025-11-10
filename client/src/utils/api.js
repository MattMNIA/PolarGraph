const API_PORT = process.env.REACT_APP_PORT || process.env.PORT || '8001';
const ENV_API_BASE_URL = process.env.REACT_APP_API_BASE_URL || process.env.API_BASE_URL;

export const API_BASE_URL = (() => {
  if (ENV_API_BASE_URL) {
    return ENV_API_BASE_URL.replace(/\/$/, '');
  }
  if (process.env.NODE_ENV === 'production') {
    return '';
  }
  return `http://localhost:${API_PORT}`;
})();

export const buildApiUrl = (path = '') => {
  if (!path.startsWith('/')) {
    return `${API_BASE_URL}/${path}`;
  }
  return `${API_BASE_URL}${path}`;
};

export const fetchPathStatus = async (signal) => {
  const init = {};
  if (signal) {
    init.signal = signal;
  }
  try {
    const response = await fetch(buildApiUrl('/api/send-path/status'), init);
    if (!response.ok) {
      if (response.status >= 500) {
        console.warn(`Path status endpoint returned ${response.status}`);
      }
      return null;
    }
    try {
      return await response.json();
    } catch (error) {
      console.warn('Failed to parse status response:', error);
      return null;
    }
  } catch (error) {
    if (error?.name !== 'AbortError') {
      console.warn('Path status request failed:', error);
    }
    return null;
  }
};
