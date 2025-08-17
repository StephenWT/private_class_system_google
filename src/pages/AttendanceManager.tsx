import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import Header from '@/components/Header';
import ClassSelector from '@/components/ClassSelector';
import AttendanceGrid from '@/components/AttendanceGrid';
import ClassManager from '@/components/ClassManager';
import { Student } from '@/types';
import { ArrowLeft, BookOpen } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';

interface AttendanceManagerProps {
  onLogout: () => void;
}

/* ----------------- helpers (kept local) ----------------- */
// normalize many month formats to "YYYY-MM"
const toYYYYMM = (input: string) => {
  if (/^\d{4}-\d{2}$/.test(input)) return input; // already normalized
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? input : d.toISOString().slice(0, 7);
};
// month boundaries for queries
const firstDayISO = (ym: string) => `${ym}-01`; // inclusive
const nextMonthISO = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m, 1); // Date months are 0-based; passing m => next month
  return d.toISOString().slice(0, 10); // exclusive
};
/* -------------------------------------------------------- */

const AttendanceManager = ({ onLogout }: AttendanceManagerProps) => {
  const [currentStep, setCurrentStep] = useState<'select' | 'attendance'>('select');
  const [selectedClass, setSelectedClass] = useState<{ class_id: string; class_name: string } | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>(''); // always keep as "YYYY-MM"
  const [customLessonDates, setCustomLessonDates] = useState<Date[] | null>(null);
  const [studentList, setStudentList] = useState<Student[]>([]);
  const [isLoadingStudents, setIsLoadingStudents] = useState(false);
  const [activeTab, setActiveTab] = useState('attendance');
  const { toast } = useToast();

  const handleClassSelection = async (
    classData: { class_id: string; class_name: string },
    month: string,
    customDates?: Date[]
  ) => {
    const normalizedMonth = toYYYYMM(month);
    setSelectedClass(classData);
    setSelectedMonth(normalizedMonth);
    setCustomLessonDates(customDates || null);
    setIsLoadingStudents(true);

    try {
      const studentData = await loadStudentsForClass(classData.class_id);
      setStudentList(studentData);
      setCurrentStep('attendance');
    } catch (error) {
      toast({
        title: 'Error loading students',
        description: error instanceof Error ? error.message : 'Failed to load students',
        variant: 'destructive',
      });
    } finally {
      setIsLoadingStudents(false);
    }
  };

  const loadStudentsForClass = async (classId: string): Promise<Student[]> => {
    try {
      const { data: userData } = await supabase.auth.getUser();
      const teacherId = userData?.user?.id;
      if (!teacherId) throw new Error('User not authenticated');

      // which students have schedules in this class
      const { data: schedules, error: schedError } = await supabase
        .from('lesson_schedules')
        .select('student_id')
        .eq('class_id', classId);

      if (schedError) throw schedError;

      const studentIds = Array.from(new Set((schedules ?? []).map((s) => s.student_id)));
      if (studentIds.length === 0) return [];

      const { data: studentData, error: studentError } = await supabase
        .from('students')
        .select('id, student_name, parent_email, payment_status, invoice_amount, last_payment_date')
        .in('id', studentIds)
        .eq('teacher_id', teacherId)
        .order('student_name', { ascending: true });

      if (studentError) throw studentError;

      return (studentData ?? []).map((s) => ({
        student_id: s.id,
        student_name: s.student_name,
        parent_email: s.parent_email ?? undefined,
        payment_status: (s.payment_status ?? null) as any,
        invoice_amount: (s.invoice_amount ?? null) as any,
        last_payment_date: (s.last_payment_date ?? null) as any,
      }));
    } catch (error) {
      console.error('Error loading students for class:', error);
      return [];
    }
  };

  const handleTakeAttendanceFromClassManager = async (classData: { class_id: string; class_name: string }) => {
    // default to current month, normalized as YYYY-MM
    const ym = new Date().toISOString().slice(0, 7);
    await handleClassSelection(classData, ym);
  };

  const handleBackToSelection = () => {
    setCurrentStep('select');
    setSelectedClass(null);
    setSelectedMonth('');
    setCustomLessonDates(null);
    setStudentList([]);
    setActiveTab('attendance');
  };

  /* ----------------- auto-hydrate lesson dates -----------------
     If the user didn’t supply custom dates, pull the already-saved
     lesson_schedules for the chosen class & month and feed those dates
     to AttendanceGrid so the calendar isn’t blank on re-entry.
  ---------------------------------------------------------------- */
  useEffect(() => {
    const hydrateDates = async () => {
      if (!selectedClass || !selectedMonth) return;
      if (customLessonDates !== null) return; // respect user-provided dates

      try {
        const startISO = firstDayISO(selectedMonth);
        const endISO = nextMonthISO(selectedMonth);

        const { data: schedules, error } = await supabase
          .from('lesson_schedules')
          .select('lesson_date')
          .eq('class_id', selectedClass.class_id)
          .gte('lesson_date', startISO)
          .lt('lesson_date', endISO)
          .order('lesson_date');

        if (error) throw error;

        // Deduplicate by date; we only need the set of lesson dates (class-wide)
        const unique = Array.from(
          new Set((schedules ?? []).map((s) => new Date(s.lesson_date).toISOString().slice(0, 10)))
        );
        const dates = unique.map((iso) => new Date(iso));
        if (dates.length) setCustomLessonDates(dates);
      } catch (e) {
        console.error(e);
        // Non-fatal: grid will still allow picking/generating dates
      }
    };

    hydrateDates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClass?.class_id, selectedMonth]);

  if (isLoadingStudents) {
    return (
      <div className="min-h-screen bg-background">
        <Header onLogout={onLogout} />
        <div className="container mx-auto px-4 py-8 flex items-center justify-center min-h-[50vh]">
          <div className="text-center">
            <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading students...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header onLogout={onLogout} />

      {currentStep === 'select' ? (
        <div className="container mx-auto px-4 py-8">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="attendance" className="flex items-center gap-2">
                <BookOpen className="w-4 h-4" />
                Take Attendance
              </TabsTrigger>
              <TabsTrigger value="classes" className="flex items-center gap-2">
                <BookOpen className="w-4 h-4" />
                Manage Classes
              </TabsTrigger>
            </TabsList>

            <TabsContent value="attendance">
              <ClassSelector onSelectionComplete={handleClassSelection} />
            </TabsContent>

            <TabsContent value="classes">
              <ClassManager onTakeAttendance={handleTakeAttendanceFromClassManager} />
            </TabsContent>
          </Tabs>
        </div>
      ) : (
        <div className="container mx-auto px-4 py-6">
          <div className="mb-6">
            <Button variant="outline" onClick={handleBackToSelection} className="flex items-center gap-2 mb-4">
              <ArrowLeft className="w-4 h-4" />
              Back to Main Menu
            </Button>
          </div>

          {selectedClass && (
            <AttendanceGrid
              selectedClass={selectedClass}
              selectedMonth={selectedMonth}           // normalized "YYYY-MM"
              customLessonDates={customLessonDates}   // auto-hydrated if previously saved
              students={studentList}
              onStudentsChange={setStudentList}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default AttendanceManager;
