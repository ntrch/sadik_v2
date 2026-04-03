import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import TaskBoard from '../components/tasks/TaskBoard';
import TaskModal from '../components/tasks/TaskModal';

export default function TasksPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="h-full flex flex-col p-6 page-transition">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold text-text-primary">Görevler</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-accent-blue hover:bg-accent-blue-hover text-white text-sm font-medium rounded-btn transition-colors"
        >
          <Plus size={16} />
          Yeni Görev
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        <TaskBoard key={refreshKey} />
      </div>
      {showCreate && (
        <TaskModal
          onClose={() => setShowCreate(false)}
          onSaved={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
