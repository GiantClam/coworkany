
import React from 'react';
import { useUIStore } from '../../stores/uiStore';
import { SearchBar } from './SearchBar';
import { TaskList } from './TaskList';
import { TaskDetailPanel } from './TaskDetailPanel';

export const SearchRoot: React.FC = () => {
    const { isTaskWindowOpen, isDetailWindowOpen } = useUIStore();

    const isAnyWindowOpen = isTaskWindowOpen || isDetailWindowOpen;

    return (
        <div className={`h-full w-full bg-transparent flex justify-center font-sans transition-all duration-500 ease-in-out ${isAnyWindowOpen ? 'items-start pt-8' : 'items-center pt-0'}`}>
            {/* Main Container - Centered */}
            <div className={`relative flex flex-row gap-4 transition-all duration-300`}>

                {/* Center Column: Search Bar & Task List */}
                <div className="flex flex-col gap-2 w-[550px] transition-all duration-300">
                    <SearchBar />

                    {/* Magnetic Task Window (Expands Below) */}
                    <div
                        className={`overflow-hidden transition-all duration-300 ease-in-out origin-top ${isTaskWindowOpen ? 'h-[400px] opacity-100 scale-100' : 'h-0 opacity-0 scale-95'}`}
                    >
                        <TaskList />
                    </div>
                </div>

                {/* Right Column: Task Detail (Appears on Side) */}
                <div className={`overflow-hidden transition-all duration-300 ease-in-out origin-left ${isDetailWindowOpen ? 'w-[450px] opacity-100 scale-100 ml-2' : 'w-0 opacity-0 scale-95 ml-0'}`}>
                    <div className="h-[calc(100vh-64px)] rounded-xl shadow-xl border border-gray-200 overflow-hidden bg-white">
                        <TaskDetailPanel />
                    </div>
                </div>

            </div>
        </div>
    );
};
