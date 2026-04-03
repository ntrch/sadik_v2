import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Task, tasksApi } from '../../api/tasks';
import TaskColumn from './TaskColumn';
import TaskModal from './TaskModal';
import { AppContext } from '../../context/AppContext';

const COLUMNS = [
  { status: 'todo', label: 'Yapılacak' },
  { status: 'in_progress', label: 'Devam Ediyor' },
  { status: 'done', label: 'Tamamlandı' },
  { status: 'cancelled', label: 'İptal Edildi' },
  { status: 'planned', label: 'Planlandı' },
  { status: 'archived', label: 'Arşiv' },
];

export default function TaskBoard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | undefined>();
  const [showModal, setShowModal] = useState(false);
  const [defaultStatus, setDefaultStatus] = useState('todo');
  const navigate = useNavigate();
  const { showToast } = React.useContext(AppContext);

  const loadTasks = useCallback(async () => {
    try {
      const data = await tasksApi.list();
      setTasks(data);
    } catch {
      showToast('Görevler yüklenemedi', 'error');
    }
  }, [showToast]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  const openCreate = (status: string) => {
    setSelectedTask(undefined);
    setDefaultStatus(status);
    setShowModal(true);
  };

  const openEdit = (task: Task) => {
    setSelectedTask(task);
    setShowModal(true);
  };

  const handleStartPomodoro = (task: Task) => {
    navigate('/focus', { state: { taskId: task.id, taskTitle: task.title } });
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
    </>
  );
}
