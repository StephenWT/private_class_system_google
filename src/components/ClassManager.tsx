import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { BookOpen, Plus, Trash2, DollarSign, Users, Edit, ArrowRight, CalendarDays } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import StudentManager from './StudentManager';
import { Student } from '@/types';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import DateSelector from './DateSelector';

interface Class {
  id: string;
  class_name: string;
  subject?: string | null;
  hourly_rate?: number | null;
  student_count?: number;
}

interface ClassManagerProps {
  onTakeAttendance?: (classData: { class_id: string; class_name: string }) => void;
}

/** Utilities */
const now = new Date();
const pad = (n: number) => String(n).padStart(2, '0');
/** "YYYY-MM" -> "Aug 2025" */
const ymToLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
};
/** current "YYYY-MM" */
const currentYM = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;

const ClassManager = ({ onTakeAttendance }: ClassManagerProps) => {
  const { toast } = useToast();
  const [classes, setClasses] = useState<Class[]>([]);
  const [editingClass, setEditingClass] = useState<Class | null>(null);
  const [managingStudentsClass, setManagingStudentsClass] = useState<Class | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [newClass, setNewClass] = useState({ class_name: '', subject: '', hourly_rate: '' });
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingStudents, setIsLoadingStudents] = useState(false);

  // Tabs
  const [activeTab, setActiveTab] = useState<'manage' | 'create'>('manage');

  // Inline Date Setup (per class)
  const [dateSetupClassId, setDateSetupClassId] = useState<string | null>(null);
  const [datesByClass, setDatesByClass] = useState<Record<string, Date[]>>({});
  const [monthByClass, setMonthByClass] = useState<Record<string, string>>({}); // "YYYY-MM"

  // Create/Setup tab date state
  const [createMonthYM, setCreateMonthYM] = useState<string>(currentYM);
  const [createDates, setCreateDates] = useState<Date[]>([]);

  useEffect(() => {
    void loadClasses();
  }, []);

  const loadClasses = async () => {
    setIsLoading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const teacherId = userData?.user?.id;
      if (!teacherId) throw new Error('User not authenticated');

      // 1) Classes
      const { data: cls, error: clsErr } = await supabase
        .from('classes')
        .select('id, class_name, subject, hourly_rate')
        .eq('teacher_id', teacherId)
        .order('class_name', { ascending: true });
      if (clsErr) throw clsErr;

      const classList = (cls ?? []) as Class[];
      const classIds = classList.map((c) => c.id);

      // 2) Count distinct students per class via lesson_schedules
      let counts: Record<string, number> = {};
      if (classIds.length > 0) {
        const { data: scheds, error: sErr } = await supabase
          .from('lesson_schedules')
          .select('class_id, student_id')
          .in('class_id', classIds);
        if (sErr) throw sErr;

        const map = new Map<string, Set<string>>();
        (scheds ?? []).forEach((r) => {
          if (!map.has(r.class_id)) map.set(r.class_id, new Set());
          map.get(r.class_id)!.add(r.student_id);
        });
        counts = Object.fromEntries([...map.entries()].map(([k, v]) => [k, v.size]));
      }

      setClasses(classList.map((c) => ({ ...c, student_count: counts[c.id] ?? 0 })));

      // Initialize per-class month to current month if missing
      setMonthByClass((prev) => {
        const copy = { ...prev };
        classList.forEach((c) => {
          if (!copy[c.id]) copy[c.id] = currentYM;
        });
        return copy;
      });
    } catch (error) {
      toast({
        title: 'Error loading classes',
        description: error instanceof Error ? error.message : 'Failed to load classes',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const addClass = async () => {
    const name = newClass.class_name.trim();
    if (!name) {
      toast({ title: 'Class name required', description: 'Please enter a class name', variant: 'destructive' });
      return;
    }

    try {
      const { data: userData } = await supabase.auth.getUser();
      const teacherId = userData?.user?.id;
      if (!teacherId) throw new Error('User not authenticated');

      const subject = newClass.subject.trim() || null;
      const rate = newClass.hourly_rate ? Number(newClass.hourly_rate) : null;

      const { data, error } = await supabase
        .from('classes')
        .insert([{ class_name: name, subject, hourly_rate: rate, teacher_id: teacherId }])
        .select('id, class_name, subject, hourly_rate')
        .single();
      if (error) throw error;

      toast({ title: 'Class added', description: `${name} has been added successfully` });
      setNewClass({ class_name: '', subject: '', hourly_rate: '' });

      // Optimistic update
      const added = data as Class;
      setClasses((prev) => [{ ...added, student_count: 0 }, ...prev]);
      setMonthByClass((prev) => ({ ...prev, [added.id]: currentYM }));

      // Keep user on Create tab so they can set dates immediately if they want
      setActiveTab('create');
    } catch (error) {
      toast({
        title: 'Error adding class',
        description: error instanceof Error ? error.message : 'Failed to add class',
        variant: 'destructive',
      });
    }
  };

  const updateClass = async () => {
    if (!editingClass) return;
    const name = editingClass.class_name.trim();
    if (!name) {
      toast({ title: 'Class name required', description: 'Please enter a class name', variant: 'destructive' });
      return;
    }
    try {
      const { error } = await supabase
        .from('classes')
        .update({
          class_name: name,
          subject: editingClass.subject?.trim() || null,
          hourly_rate: editingClass.hourly_rate || null,
        })
        .eq('id', editingClass.id);
      if (error) throw error;

      toast({ title: 'Class updated', description: `${name} has been updated successfully` });
      setEditingClass(null);
      setClasses((prev) => prev.map((c) => (c.id === editingClass.id ? editingClass : c)));
    } catch (error) {
      toast({
        title: 'Error updating class',
        description: error instanceof Error ? error.message : 'Failed to update class',
        variant: 'destructive',
      });
    }
  };

  const deleteClass = async (classId: string, className: string) => {
    if (!confirm(`Are you sure you want to delete "${className}"? This will also delete all associated students and attendance records.`)) {
      return;
    }
    try {
      const { error } = await supabase.from('classes').delete().eq('id', classId);
      if (error) throw error;

      setClasses((prev) => prev.filter((c) => c.id !== classId));
      setDatesByClass((prev) => {
        const copy = { ...prev };
        delete copy[classId];
        return copy;
      });
      setMonthByClass((prev) => {
        const copy = { ...prev };
        delete copy[classId];
        return copy;
      });

      toast({ title: 'Class deleted', description: `${className} has been deleted` });
    } catch (error) {
      toast({
        title: 'Error deleting class',
        description: error instanceof Error ? error.message : 'Failed to delete class',
        variant: 'destructive',
      });
    }
  };

  const loadStudentsForClass = async (classId: string) => {
    setIsLoadingStudents(true);
    try {
      const { data: schedules, error: schedError } = await supabase
        .from('lesson_schedules')
        .select('student_id')
        .eq('class_id', classId);
      if (schedError) throw schedError;

      const studentIds = Array.from(new Set((schedules ?? []).map((s) => s.student_id)));
      if (studentIds.length === 0) {
        setStudents([]);
        return;
      }

      const { data: studentData, error: studentError } = await supabase
        .from('students')
        .select('id, student_name, parent_email, payment_status, invoice_amount, last_payment_date')
        .in('id', studentIds)
        .order('student_name', { ascending: true });
      if (studentError) throw studentError;

      const formatted: Student[] = (studentData ?? []).map((s) => ({
        student_id: s.id,
        student_name: s.student_name,
        parent_email: s.parent_email ?? undefined,
        payment_status: (s.payment_status ?? null) as any,
        invoice_amount: (s.invoice_amount ?? null) as any,
        last_payment_date: (s.last_payment_date ?? null) as any,
      }));

      setStudents(formatted);
    } catch (error) {
      toast({
        title: 'Error loading students',
        description: error instanceof Error ? error.message : 'Failed to load students',
        variant: 'destructive',
      });
      setStudents([]);
    } finally {
      setIsLoadingStudents(false);
    }
  };

  const handleManageStudents = async (cls: Class) => {
    setManagingStudentsClass(cls);
    setDateSetupClassId(null); // close date setup panel when switching
    await loadStudentsForClass(cls.id);
  };

  const handleStudentsChange = (updatedStudents: Student[]) => {
    setStudents(updatedStudents);
    setClasses((prev) =>
      prev.map((c) => (c.id === managingStudentsClass?.id ? { ...c, student_count: updatedStudents.length } : c)),
    );
  };

  const classesEmpty = useMemo(() => classes.length === 0, [classes]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  // Student management view
  if (managingStudentsClass) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <Users className="w-6 h-6 text-primary" />
              Manage Students - {managingStudentsClass.class_name}
            </h2>
            <p className="text-muted-foreground">Add, remove, and manage students for this class</p>
          </div>
          <div className="flex gap-2">
            {onTakeAttendance && (
              <Button
                onClick={() =>
                  onTakeAttendance({
                    class_id: managingStudentsClass.id,
                    class_name: managingStudentsClass.class_name,
                  })
                }
                className="flex items-center gap-2"
              >
                <ArrowRight className="w-4 h-4" />
                Take Attendance
              </Button>
            )}
            <Button variant="outline" onClick={() => setManagingStudentsClass(null)}>
              Back to Classes
            </Button>
          </div>
        </div>

        {isLoadingStudents ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        ) : (
          <StudentManager
            students={students}
            onStudentsChange={handleStudentsChange}
            classId={managingStudentsClass.id}
            plannedDatesIso={[]} // (optional) can wire from datesByClass[managingStudentsClass.id]
          />
        )}
      </div>
    );
  }

  // Hub view with tabs
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-primary" />
              <CardTitle>Classes</CardTitle>
            </div>
            <Button onClick={() => setActiveTab('create')} size="sm" className="flex items-center gap-2">
              <Plus className="w-4 h-4" />
              New Class
            </Button>
          </div>
          <CardDescription>Manage classes, students, attendance, and date setup.</CardDescription>
        </CardHeader>

        <CardContent>
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'manage' | 'create')}>
            <TabsList className="mb-4">
              <TabsTrigger value="manage">Manage</TabsTrigger>
              <TabsTrigger value="create">Create / Setup</TabsTrigger>
            </TabsList>

            {/* MANAGE TAB */}
            <TabsContent value="manage" className="space-y-4">
              {classesEmpty ? (
                <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
                  <BookOpen className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No classes created yet</p>
                  <p className="text-sm">Create your first class in the “Create / Setup” tab</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {classes.map((cls) => (
                    <Card key={cls.id} className="bg-card">
                      <CardContent className="pt-6">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <h4 className="font-semibold text-lg">{cls.class_name}</h4>
                            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                              {cls.subject && <span>Subject: {cls.subject}</span>}
                              {cls.hourly_rate != null && (
                                <div className="flex items-center gap-1">
                                  <DollarSign className="w-3 h-3" />
                                  <span>{cls.hourly_rate}/hour</span>
                                </div>
                              )}
                              <div className="flex items-center gap-1">
                                <Users className="w-3 h-3" />
                                <span>{cls.student_count ?? 0} students</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleManageStudents(cls)}
                              className="flex items-center gap-2"
                            >
                              <Users className="w-4 h-4" />
                              Manage Students
                            </Button>

                            {onTakeAttendance && (
                              <Button
                                size="sm"
                                onClick={() => onTakeAttendance({ class_id: cls.id, class_name: cls.class_name })}
                                className="flex items-center gap-2"
                              >
                                <ArrowRight className="w-4 h-4" />
                                Take Attendance
                              </Button>
                            )}

                            <Button
                              variant={dateSetupClassId === cls.id ? 'default' : 'outline'}
                              size="sm"
                              onClick={() => setDateSetupClassId((cur) => (cur === cls.id ? null : cls.id))}
                              className="flex items-center gap-2"
                            >
                              <CalendarDays className="w-4 h-4" />
                              Setup Dates
                            </Button>

                            <Dialog>
                              <DialogTrigger asChild>
                                <Button variant="outline" size="sm" onClick={() => setEditingClass({ ...cls })}>
                                  <Edit className="w-4 h-4" />
                                </Button>
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>Edit Class</DialogTitle>
                                  <DialogDescription>Update the class information</DialogDescription>
                                </DialogHeader>

                                {editingClass && (
                                  <div className="space-y-4">
                                    <div className="space-y-2">
                                      <Label>Class Name *</Label>
                                      <Input
                                        value={editingClass.class_name}
                                        onChange={(e) => setEditingClass({ ...editingClass, class_name: e.target.value })}
                                      />
                                    </div>

                                    <div className="space-y-2">
                                      <Label>Subject</Label>
                                      <Input
                                        value={editingClass.subject || ''}
                                        onChange={(e) => setEditingClass({ ...editingClass, subject: e.target.value })}
                                      />
                                    </div>

                                    <div className="space-y-2">
                                      <Label>Hourly Rate</Label>
                                      <Input
                                        type="number"
                                        step="0.01"
                                        value={editingClass.hourly_rate || ''}
                                        onChange={(e) =>
                                          setEditingClass({
                                            ...editingClass,
                                            hourly_rate: e.target.value ? Number(e.target.value) : null,
                                          })
                                        }
                                      />
                                    </div>

                                    <div className="flex gap-2">
                                      <Button onClick={updateClass}>Update Class</Button>
                                      <Button variant="outline" onClick={() => setEditingClass(null)}>
                                        Cancel
                                      </Button>
                                    </div>
                                  </div>
                                )}
                              </DialogContent>
                            </Dialog>

                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => deleteClass(cls.id, cls.class_name)}
                              className="text-destructive hover:text-destructive-foreground hover:bg-destructive"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>

                        {/* Inline Date Setup panel */}
                        {dateSetupClassId === cls.id && (
                          <div className="mt-5 border rounded-lg p-4">
                            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
                              <div className="flex items-center gap-2">
                                <CalendarDays className="w-4 h-4" />
                                <h5 className="font-semibold">Date Setup — {cls.class_name}</h5>
                              </div>
                              <div className="flex items-center gap-2">
                                <Label className="text-sm">Month</Label>
                                <Input
                                  type="month"
                                  value={monthByClass[cls.id] ?? currentYM}
                                  onChange={(e) =>
                                    setMonthByClass((prev) => ({ ...prev, [cls.id]: e.target.value || currentYM }))
                                  }
                                  className="w-40"
                                />
                                <Button variant="ghost" size="sm" onClick={() => setDateSetupClassId(null)}>
                                  Close
                                </Button>
                              </div>
                            </div>

                            <DateSelector
                              month={ymToLabel(monthByClass[cls.id] ?? currentYM)}
                              selectedDates={datesByClass[cls.id] ?? []}
                              onDatesChange={(dates) =>
                                setDatesByClass((prev) => ({
                                  ...prev,
                                  [cls.id]: dates,
                                }))
                              }
                            />

                            {/* Hook up persistence when ready */}
                            {/* <div className="mt-3 flex gap-2">
                              <Button size="sm" onClick={() => saveDatesForClass(cls.id, datesByClass[cls.id] ?? [])}>
                                Save Dates
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setDatesByClass((prev) => ({ ...prev, [cls.id]: [] }))
                                }
                              >
                                Clear
                              </Button>
                            </div> */}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* CREATE / SETUP TAB */}
            <TabsContent value="create" className="space-y-4">
              <Card className="bg-accent/20">
                <CardContent className="pt-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Class Name *</Label>
                      <Input
                        placeholder="e.g., Form 2.22 English"
                        value={newClass.class_name}
                        onChange={(e) => setNewClass({ ...newClass, class_name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Subject</Label>
                      <Input
                        placeholder="e.g., Mathematics"
                        value={newClass.subject}
                        onChange={(e) => setNewClass({ ...newClass, subject: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Hourly Rate</Label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="50.00"
                        value={newClass.hourly_rate}
                        onChange={(e) => setNewClass({ ...newClass, hourly_rate: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="flex gap-2 mt-4">
                    <Button onClick={addClass} size="sm">Add Class</Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setNewClass({ class_name: '', subject: '', hourly_rate: '' })}
                    >
                      Clear
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <CardTitle>Custom Dates</CardTitle>
                      <CardDescription>Set up session dates for a month.</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Label className="text-sm">Month</Label>
                      <Input
                        type="month"
                        value={createMonthYM}
                        onChange={(e) => setCreateMonthYM(e.target.value || currentYM)}
                        className="w-40"
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <DateSelector
                    month={ymToLabel(createMonthYM)}
                    selectedDates={createDates}
                    onDatesChange={setCreateDates}
                  />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};

export default ClassManager;
