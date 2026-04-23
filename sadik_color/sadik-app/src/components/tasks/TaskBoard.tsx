import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Task, tasksApi } from '../../api/tasks';
import TaskColumn from './TaskColumn';
import TaskModal from './TaskModal';
import TaskDetailDrawer from './TaskDetailDrawer';
import { AppContext } from '../../context/AppContext';

const COLUMNS = [
  { status: 'todo',        label: 'Yapılacak' },
  { status: 'in_progress', label: 'Devam Ediyor' },
  { status: 'done',        label: 'Tamamlandı' },
  { status: 'cancelled',   label: 'İptal Edildi' },
  { status: 'planned',     label: 'Planlandı' },
  { status: 'archived',    label: 'Arşiv' },
];

interface TaskBoardProps {
  highlightTaskId?: number | null;
}

export default function TaskBoard({ highlightTaskId }: TaskBoardProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | undefined>();
  const [showModal, setShowModal] = useState(false);
  const [drawerTask, setDrawerTask] = useState<Task | null>(null);
  const [defaultStatus, setDefaultStatus] = useState('todo');
  const [draggedTaskId, setDraggedTaskId] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const navigate = useNavigate();
  const { showToast, triggerEvent } = React.useContext(AppContext);
  const highlightHandledRef = useRef(false);

  const loadTasks = useCallback(async () => {
    try {
      const data = await tasksApi.list();
      setTasks(data);
    } catch {
      showToast('Görevler yüklenemedi', 'error');
    }
  }, [showToast]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  // When navigated from Dashboard with a taskId, auto-open that task's modal once.
  useEffect(() => {
    if (!highlightTaskId || highlightHandledRef.current || tasks.length === 0) return;
    const target = tasks.find((t) => t.id === highlightTaskId);
    if (target) {
      highlightHandledRef.current = true;
      setDrawerTask(target);
    }
  }, [highlightTaskId, tasks]);

  const openCreate = (status: string) => {
    setSelectedTask(undefined);
    setDefaultStatus(status);
    setShowModal(true);
  };

  const openEdit = (task: Task) => {
    setDrawerTask(task);
  };

  const handleStartPomodoro = (task: Task) => {
    navigate('/tasks', { state: { tab: 'focus', taskId: task.id } });
  };

  const handleDragStart = (taskId: number) => {
    setDraggedTaskId(taskId);
  };

  const handleDragOver = (e: React.DragEvent, status: string) => {
    e.preventDefault();
    setDropTarget(status);
  };

  const handleDragLeave = () => {
    setDropTarget(null);
  };

  const handleDrop = async (e: React.DragEvent, targetStatus: string) => {
    e.preventDefault();
    setDropTarget(null);
    if (draggedTaskId === null) return;

    const task = tasks.find((t) => t.id === draggedTaskId);
    if (!task || task.status === targetStatus) {
      setDraggedTaskId(null);
      return;
    }

    // Optimistic update
    setTasks((prev) =>
      prev.map((t) => (t.id === draggedTaskId ? { ...t, status: targetStatus } : t))
    );
    setDraggedTaskId(null);

    try {
      await tasksApi.updateStatus(draggedTaskId, targetStatus);
      showToast(`Görev taşındı`, 'success');
      // Fire done animation only when moving TO done from a non-done status
      if (targetStatus === 'done' && task.status !== 'done') {
        triggerEvent('confirmation_done');
      }
    } catch {
      showToast('Görev taşınamadı', 'error');
      loadTasks(); // revert
    }
  };

  const handleDragEnd = () => {
    setDraggedTaskId(null);
    setDropTarget(null);
  };

  const tasksByStatus = (status: string) => tasks.filter((t) => t.status === status);

  return (
    <>
      <div className="flex gap-4 overflow-x-auto pb-4 h-full">
        {COLUMNS.map(({ status, label }) => (
          <TaskColumn
            key={status}
            status={status}
            label={label}
            tasks={tasksByStatus(status)}
            onCardClick={openEdit}
            onAddClick={status === 'todo' ? () => openCreate(status) : undefined}
            onStartPomodoro={handleStartPomodoro}
            onDragStart={handleDragStart}
            onDragOver={(e) => handleDragOver(e, status)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, status)}
            onDragEnd={handleDragEnd}
            isDropTarget={dropTarget === status}
            draggedTaskId={draggedTaskId}
          />
        ))}
      </div>

      {showModal && (
        <TaskModal
          task={selectedTask}
          defaultStatus={defaultStatus}
          onClose={() => setShowModal(false)}
          onSaved={loadTasks}
        />
      )}

      {drawerTask && (
        <TaskDetailDrawer
          task={drawerTask}
          onClose={() => setDrawerTask(null)}
          onSaved={loadTasks}
        />
      )}
    </>
  );
}
