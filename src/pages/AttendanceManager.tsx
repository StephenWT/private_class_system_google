import { useState, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import Header from '@/components/Header';
import ClassSelector from '@/components/ClassSelector';
import AttendanceGrid from '@/components/AttendanceGrid';
import { Student } from '@/types';
import { BookOpen, Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { getLastClassId, setLastClassId, getCurrentMonthYYYYMM, getTodayISO } from '@/lib/nav';

interface AttendanceManagerProps {
  onLogout: () => void;
}

const AttendanceManager = ({ onLogout }: AttendanceManagerProps) => {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [availableClasses, setAvailableClasses] = useState<Array<{ id: string; class_name: string }>>([]);
  const [selectedClass, setSelectedClass] = useState<{ class_id: string; class_name: string } | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonthYYYYMM());
  const [customLessonDates, setCustomLessonDates] = useState<Date[] | null>(null);
  const [studentList, setStudentList] = useState<Student[]>([]);
  const [isLoadingStudents, setIsLoadingStudents] = useState(false);
  const [isLoadingClasses, setIsLoadingClasses] = useState(true);
  const [showClassSelector, setShowClassSelector] = useState(false);

  // Load available classes
  useEffect(() => {
    loadAvailableClasses();
  }, []);

  // Handle route params and class selection
  useEffect(() => {
    const classId = params.classId;
    
    if (classId && classId !== 'last') {
      // Direct class route
      const classData = availableClasses.find(c => c.id === classId);
      if (classData) {
        handleClassSelection(
          { class_id: classData.id, class_name: classData.class_name },
          searchParams.get('date') || getCurrentMonthYYYYMM()
        );
      }
    } else if (!classId || classId === 'last') {
      // No class specified, try to use last class or show selector
      if (availableClasses.length === 0) {
        // Still loading or no classes
        return;
      }
      
      const lastClassId = getLastClassId();
      const lastClass = availableClasses.find(c => c.id === lastClassId);
      
      if (lastClass) {
        // Redirect to the last used class
        navigate(`/attendance/${lastClass.id}`, { replace: true });
      } else if (availableClasses.length === 1) {
        // Only one class, use it automatically
        navigate(`/attendance/${availableClasses[0].id}`, { replace: true });
      } else {
        // Show class selector
        setShowClassSelector(true);
      }
    }
  }, [params.classId, availableClasses, searchParams, navigate]);

  const loadAvailableClasses = async () => {
    setIsLoadingClasses(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const teacherId = userData?.user?.id;
      if (!teacherId) throw new Error('User not authenticated');

      const { data, error } = await supabase
        .from('classes')
        .select('id, class_name')
        .eq('teacher_id', teacherId)
        .order('class_name', { ascending: true });

      if (error) throw error;
      setAvailableClasses((data ?? []) as Array<{ id: string; class_name: string }>);
    } catch (error) {
      toast({
        title: 'Error loading classes',
        description: error instanceof Error ? error.message : 'Failed to load classes',
        variant: 'destructive',
      });
    } finally {
      setIsLoadingClasses(false);
    }
  };

  const handleClassSelection = async (
    classData: { class_id: string; class_name: string },
    month: string,
    customDates?: Date[]
  ) => {
    const normalizedMonth = month.length === 7 ? month : month.slice(0, 7); // Ensure YYYY-MM format
    setSelectedClass(classData);
    setSelectedMonth(normalizedMonth);
    setCustomLessonDates(customDates || null);
    setShowClassSelector(false);
    setIsLoadingStudents(true);
    
    // Remember this class
    setLastClassId(classData.class_id);

    try {
      const studentData = await loadStudentsForClass(classData.class_id);
      setStudentList(studentData);
      
      // Update URL if needed
      if (params.classId !== classData.class_id) {
        navigate(`/attendance/${classData.class_id}`, { replace: true });
      }
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

  const handleClassChange = (newClassId: string) => {
    navigate(`/attendance/${newClassId}`);
  };

  const handleCreateFirstClass = () => {
    navigate('/classes');
  };

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

  if (isLoadingClasses) {
    return (
      <div className="min-h-screen bg-background">
        <Header onLogout={onLogout} />
        <div className="container mx-auto px-4 py-8 flex items-center justify-center min-h-[50vh]">
          <div className="text-center">
            <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading classes...</p>
          </div>
        </div>
      </div>
    );
  }

  // No classes exist - show empty state
  if (availableClasses.length === 0) {
    return (
      <div className="min-h-screen bg-background">
        <Header onLogout={onLogout} />
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center justify-center min-h-[50vh]">
            <Card className="w-full max-w-md">
              <CardHeader className="text-center">
                <BookOpen className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <CardTitle>No Classes Yet</CardTitle>
                <CardDescription>
                  Create your first class to start taking attendance
                </CardDescription>
              </CardHeader>
              <CardContent className="text-center">
                <Button onClick={handleCreateFirstClass} className="flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  Create First Class
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // Show class selector if no class is selected
  if (showClassSelector) {
    return (
      <div className="min-h-screen bg-background">
        <Header onLogout={onLogout} />
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center justify-center min-h-[50vh]">
            <Card className="w-full max-w-md">
              <CardHeader className="text-center">
                <BookOpen className="w-8 h-8 mx-auto mb-4 text-primary" />
                <CardTitle>Select Class</CardTitle>
                <CardDescription>
                  Choose a class to take attendance
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ClassSelector 
                  mode="compact" 
                  onSelectionComplete={(classData, month, customDates) => {
                    handleClassSelection(classData, month, customDates);
                  }}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // Main attendance view
  return (
    <div className="min-h-screen bg-background">
      <Header onLogout={onLogout} />
      
      <div className="container mx-auto px-4 py-6">
        {/* Top bar with class selector and date controls */}
        {selectedClass && (
          <div className="flex items-center justify-between mb-6 p-4 bg-card rounded-lg border">
            <div className="flex items-center gap-4">
              <ClassSelector 
                mode="compact"
                onSelectionComplete={(classData, month, customDates) => {
                  if (classData.class_id !== selectedClass.class_id) {
                    handleClassChange(classData.class_id);
                  }
                }}
              />
            </div>
            <div className="text-sm text-muted-foreground">
              {selectedMonth}
            </div>
          </div>
        )}

        {selectedClass && (
          <AttendanceGrid
            selectedClass={selectedClass}
            selectedMonth={selectedMonth}
            customLessonDates={customLessonDates}
            students={studentList}
            onStudentsChange={setStudentList}
          />
        )}
      </div>
    </div>
  );
};

export default AttendanceManager;

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
