import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import type { Student, AttendanceRecord, AttendanceData } from '@/types';
import { formatDateKey } from '@/lib/dateUtils';
import { attendance } from '@/lib/api';
import { Save, Loader2, ArrowLeft } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import StudentManager from './StudentManager';
import { getTodayISO } from '@/lib/nav';

interface AttendanceGridProps {
  selectedClass: { class_id: string; class_name: string };
  /** normalized, e.g. "2025-08" */
  selectedMonth: string;
  customLessonDates?: Date[] | null;
  students: Student[];
  onStudentsChange: (students: Student[]) => void;
}

const firstDayISO = (ym: string) => `${ym}-01`;           // inclusive
const nextMonthISO = (ym: string) => {                    // exclusive
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m, 1); // Date months are 0-based; passing m => next month
  return d.toISOString().slice(0, 10);
};

const daysFromYYYYMM = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  const result: Date[] = [];
  const d = new Date(y, m - 1, 1);
  while (d.getMonth() === m - 1) {
    result.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return result;
};

const AttendanceGrid = ({
  selectedClass,
  selectedMonth,
  customLessonDates,
  students,
  onStudentsChange,
}: AttendanceGridProps) => {
  // Key attendance by "<studentId>-<YYYY-MM-DD>"
  const navigate = useNavigate();
  const [attendanceData, setAttendanceData] = useState<Map<string, boolean>>(new Map());
  const [isSaving, setIsSaving] = useState(false);
  const [currentView, setCurrentView] = useState<'attendance' | 'students'>('students');
  const { toast } = useToast();

  // Dates from DB (lesson_schedules) or local cache
  const [dbDatesIso, setDbDatesIso] = useState<string[] | null>(null);

  // Which students have any schedule rows in this class (membership)
  const [enrolledIds, setEnrolledIds] = useState<Set<string> | null>(null);

  const handleManageStudents = () => {
    navigate(`/classes/${selectedClass.class_id}/students`);
  };

  // ---- Load planned dates + pre-check attendance for the month ----
  useEffect(() => {
    let ignore = false;

    (async () => {
      // if custom dates provided, let them take precedence & don't fetch DB dates
      if (customLessonDates && customLessonDates.length > 0) {
        setDbDatesIso(null);
        // still want to hydrate attendance for any schedules that exist this month
        // but dates list is coming from customLessonDates
      }

      const startISO = firstDayISO(selectedMonth);
      const endISO = nextMonthISO(selectedMonth);

      // 1) Fetch schedules for class+month (all students)
      const { data: schedules, error: sErr } = await supabase
        .from('lesson_schedules')
        .select('id, student_id, lesson_date')
        .eq('class_id', selectedClass.class_id)
        .gte('lesson_date', startISO)
        .lt('lesson_date', endISO)
        .order('lesson_date');

      if (ignore) return;

      if (sErr) {
        // fall back to local cache only for the dates
        const local = localStorage.getItem(`lesson_dates:${selectedClass.class_id}:${selectedMonth}`);
        setDbDatesIso(local ? JSON.parse(local) : null);
        return;
      }

      // Build the set of planned dates from schedules if no custom dates
      const isoDates = Array.from(
        new Set((schedules ?? []).map((r: any) => (r.lesson_date as string).slice(0, 10)))
      ).sort();

      if (!customLessonDates || customLessonDates.length === 0) {
        if (isoDates.length) {
          setDbDatesIso(isoDates);
        } else {
          // fall back to local cache (before schedules exist)
          const local = localStorage.getItem(`lesson_dates:${selectedClass.class_id}:${selectedMonth}`);
          setDbDatesIso(local ? JSON.parse(local) : null);
        }
      }

      // 2) Preload attendance from attendance_records for these schedules
      const scheduleIds = (schedules ?? []).map((r: any) => r.id);
      if (scheduleIds.length) {
        const { data: atts, error: aErr } = await supabase
          .from('attendance_records')
          .select('lesson_schedule_id, student_id, attended')
          .in('lesson_schedule_id', scheduleIds);

        if (!aErr && atts) {
          // Map schedule -> date for key construction
          const dateBySchedule = new Map<string, string>();
          (schedules ?? []).forEach((r: any) => {
            dateBySchedule.set(r.id, (r.lesson_date as string).slice(0, 10));
          });

          const next = new Map<string, boolean>();
          (atts as any[]).forEach((rec) => {
            if (rec.attended) {
              const iso = dateBySchedule.get(rec.lesson_schedule_id);
              if (iso) {
                next.set(`${rec.student_id}-${iso}`, true);
              }
            }
          });

          setAttendanceData(next); // initial hydrate
        }
      }
    })();

    return () => { ignore = true; };
  }, [selectedClass.class_id, selectedMonth, customLessonDates]);

  // ---- Determine membership for the class (who shows up in the grid) ----
  useEffect(() => {
    let ignore = false;
    (async () => {
      const { data, error } = await supabase
        .from('lesson_schedules')
        .select('student_id')
        .eq('class_id', selectedClass.class_id);

      if (ignore) return;
      if (error) {
        setEnrolledIds(null);
      } else {
        setEnrolledIds(new Set((data ?? []).map((r: any) => r.student_id as string)));
      }
    })();
    return () => { ignore = true; };
  }, [selectedClass.class_id]);

  // ---- Dates to display: custom > DB > whole month ----
  const days = useMemo<Date[]>(() => {
    if (customLessonDates && customLessonDates.length > 0) return customLessonDates;
    if (dbDatesIso && dbDatesIso.length > 0) return dbDatesIso.map((s) => new Date(s));
    return daysFromYYYYMM(selectedMonth);
  }, [customLessonDates, dbDatesIso, selectedMonth]);

  const plannedIsoDates = useMemo(
    () => days.map((d) => d.toISOString().slice(0, 10)),
    [days]
  );

  // ---- Apply membership filter if we have it ----
  const studentsForThisClass = useMemo(
    () => (enrolledIds ? students.filter((s) => enrolledIds.has(s.student_id)) : students),
    [students, enrolledIds]
  );

  // ---- Attendance toggling/helpers ----
  const keyFor = (studentId: string, isoDate: string) => `${studentId}-${isoDate}`;

  const toggleAttendance = (studentId: string, isoDate: string) => {
    const key = keyFor(studentId, isoDate);
    setAttendanceData((prev) => {
      const next = new Map(prev);
      next.set(key, !prev.get(key));
      return next;
    });
  };

  const getAttendanceStatus = (studentId: string, isoDate: string): boolean => {
    const key = keyFor(studentId, isoDate);
    return attendanceData.get(key) || false;
  };

  // ---- Save ----
  const saveAttendance = async () => {
    if (!selectedClass.class_id) {
      toast({
        title: 'Create/select a class first',
        description: 'Please create or select a class before saving attendance.',
        variant: 'destructive',
      });
      return;
    }
    if (studentsForThisClass.length === 0) {
      toast({
        title: 'No students',
        description: 'Add at least one student to this class to save attendance.',
        variant: 'destructive',
      });
      return;
    }

    setIsSaving(true);
    try {
      // Build records with ISO date keys (filtered students only)
      const records: AttendanceRecord[] = studentsForThisClass.map((student) => {
        const rec: AttendanceRecord = {
          student_id: student.student_id,
          student_name: student.student_name,
        };
        days.forEach((d) => {
          const iso = d.toISOString().slice(0, 10);
          rec[iso] = getAttendanceStatus(student.student_id, iso);
        });
        return rec;
      });

      const payload: AttendanceData = {
        class_id: selectedClass.class_id,
        class_name: selectedClass.class_name,
        month: selectedMonth,        // "YYYY-MM"
        lesson_dates: plannedIsoDates,
        data: records,
        // user_id omitted; RLS uses auth.uid()
      };

      const res = await attendance.save(payload);

      // cache dates locally so UI stays populated even before schedules exist
      localStorage.setItem(
        `lesson_dates:${selectedClass.class_id}:${selectedMonth}`,
        JSON.stringify(plannedIsoDates)
      );

      toast({
        title: 'Attendance saved',
        description: `Updated ${res.updated} entries for ${res.month}.`,
      });
    } catch (error) {
      toast({
        title: 'Save failed',
        description: error instanceof Error ? error.message : 'Failed to save attendance.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-semibold text-primary">{selectedClass.class_name}</h2>
          <p className="text-muted-foreground">
            {selectedMonth}{' '}
            {customLessonDates && customLessonDates.length > 0
              ? `(${days.length} custom lessons)`
              : dbDatesIso && dbDatesIso.length > 0
              ? `(${dbDatesIso.length} planned lessons)`
              : '(full month)'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={currentView === 'students' ? 'default' : 'outline'}
            onClick={() => setCurrentView('students')}
            size="sm"
          >
            Manage Students ({studentsForThisClass.length})
          </Button>
          <Button
            variant={currentView === 'attendance' ? 'default' : 'outline'}
            onClick={() => setCurrentView('attendance')}
            size="sm"
            disabled={studentsForThisClass.length === 0}
          >
            Take Attendance
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleManageStudents}
          >
            Manage Students (Advanced)
          </Button>
        </div>
      </div>

      {/* Content */}
      {currentView === 'students' ? (
        <StudentManager
          students={studentsForThisClass}
          onStudentsChange={onStudentsChange}
          classId={selectedClass.class_id as string}
          plannedDatesIso={plannedIsoDates}
        />
      ) : (
        <div className="space-y-4">
          {/* Save Button */}
          <div className="flex justify-end">
            <Button
              onClick={saveAttendance}
              disabled={isSaving || studentsForThisClass.length === 0}
              className="flex items-center gap-2"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save Attendance
                </>
              )}
            </Button>
          </div>

          {/* Attendance Grid */}
          {studentsForThisClass.length > 0 ? (
            <div className="border rounded-lg overflow-hidden bg-card">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-grid-header border-b sticky top-0 z-10">
                      <th className="p-3 text-left font-medium border-r bg-grid-header sticky left-0 z-20 min-w-[200px]">
                        Student Name
                      </th>
                      {days.map((day) => {
                        const iso = day.toISOString().slice(0, 10);
                        return (
                          <th key={iso} className="p-2 text-center font-medium min-w-[80px] border-r">
                            <div className="text-xs text-muted-foreground">
                              {day.toLocaleDateString('en-US', { weekday: 'short' })}
                            </div>
                            <div className="text-sm">{formatDateKey(day)}</div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {studentsForThisClass.map((student) => (
                      <tr key={student.student_id} className="border-b hover:bg-grid-hover transition-colors">
                        <td className="p-3 border-r bg-grid-cell sticky left-0 z-10">
                          <div className="flex flex-col">
                            <span className="font-medium">{student.student_name}</span>
                            {student.payment_status && (
                              <span
                                className={`text-xs px-2 py-1 rounded-full w-fit mt-1 ${
                                  student.payment_status === 'paid'
                                    ? 'bg-green-100 text-green-800'
                                    : student.payment_status === 'overdue'
                                    ? 'bg-red-100 text-red-800'
                                    : 'bg-yellow-100 text-yellow-800'
                                }`}
                              >
                                {student.payment_status}
                              </span>
                            )}
                          </div>
                        </td>
                        {days.map((day) => {
                          const iso = day.toISOString().slice(0, 10);
                          const isPresent = getAttendanceStatus(student.student_id, iso);
                          return (
                            <td key={iso} className="p-1 text-center border-r">
                              <button
                                onClick={() => toggleAttendance(student.student_id, iso)}
                                className={`w-8 h-8 rounded-full border-2 transition-all duration-200 hover:scale-110 ${
                                  isPresent
                                    ? 'bg-present border-present text-white'
                                    : 'bg-white border-border hover:border-present/50'
                                }`}
                                title={`${student.student_name} - ${iso}: ${isPresent ? 'Present' : 'Absent'}`}
                              >
                                {isPresent && '✓'}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground border-2 border-dashed rounded-lg">
              <ArrowLeft className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>Add students first to take attendance</p>
              <p className="text-sm">Go to "Manage Students" to add students to this class</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AttendanceGrid;
