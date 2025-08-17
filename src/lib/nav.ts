// Navigation utilities for attendance management
export const getLastClassId = (): string | null => {
  try {
    return localStorage.getItem('last_class_id');
  } catch {
    return null;
  }
};

export const setLastClassId = (id: string): void => {
  try {
    localStorage.setItem('last_class_id', id);
  } catch {
    // Silently fail if localStorage is not available
  }
};

export const getLastAttendanceMonth = (): string | null => {
  try {
    return localStorage.getItem('last_attendance_month');
  } catch {
    return null;
  }
};

export const setLastAttendanceMonth = (month: string): void => {
  try {
    localStorage.setItem('last_attendance_month', month);
  } catch {
    // Silently fail if localStorage is not available
  }
};

export const getTodayISO = (): string => {
  return new Date().toISOString().slice(0, 10);
};

export const getCurrentMonthYYYYMM = (): string => {
  return new Date().toISOString().slice(0, 7);
};