import { useState } from 'react';
import { ApprovalRequest, ApprovalResponse } from '../types';
import { X, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';

interface ApprovalDialogProps {
  requests: Array<[string, ApprovalRequest]>;
  onApprove: (approvalId: string, response: ApprovalResponse) => void;
  onClose: () => void;
}

export default function ApprovalDialog({ requests, onApprove, onClose }: ApprovalDialogProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [inputModifications, setInputModifications] = useState<Record<string, any>>({});

  if (requests.length === 0) {
    return null;
  }

  const [approvalId, request] = requests[currentIndex];
  const hasNext = currentIndex < requests.length - 1;
  const hasPrevious = currentIndex > 0;

  const formatToolName = (toolName: string) => {
    return toolName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const formatInput = (input: any) => {
    if (typeof input === 'object') {
      return JSON.stringify(input, null, 2);
    }
    return String(input);
  };

  const handleApprove = () => {
    const updatedInput = inputModifications[approvalId] || request.input;
    const response: ApprovalResponse = {
      behavior: 'allow',
      updatedInput: updatedInput !== request.input ? updatedInput : undefined,
    };
    onApprove(approvalId, response);
    goToNext();
  };

  const handleDeny = () => {
    const response: ApprovalResponse = {
      behavior: 'deny',
      message: 'User denied permission for this operation',
    };
    onApprove(approvalId, response);
    goToNext();
  };

  const handleModifyInput = (newInput: string) => {
    try {
      const parsedInput = JSON.parse(newInput);
      setInputModifications(prev => ({
        ...prev,
        [approvalId]: parsedInput,
      }));
    } catch (error) {
      // Invalid JSON, store as string
      setInputModifications(prev => ({
        ...prev,
        [approvalId]: newInput,
      }));
    }
  };

  const goToNext = () => {
    if (hasNext) {
      setCurrentIndex(prev => prev + 1);
    } else {
      onClose();
    }
  };

  const goToPrevious = () => {
    if (hasPrevious) {
      setCurrentIndex(prev => prev - 1);
    }
  };

  const getToolIcon = (toolName: string) => {
    switch (toolName) {
      case 'execute_command':
        return <AlertTriangle className="text-yellow-400" size={20} />;
      case 'write_file':
        return <AlertTriangle className="text-orange-400" size={20} />;
      case 'read_file':
      case 'list_directory':
        return <CheckCircle className="text-blue-400" size={20} />;
      default:
        return <AlertTriangle className="text-gray-400" size={20} />;
    }
  };

  const getRiskLevel = (toolName: string) => {
    switch (toolName) {
      case 'execute_command':
        return { level: 'High Risk', color: 'text-red-400 bg-red-900/20 border-red-800' };
      case 'write_file':
        return { level: 'Medium Risk', color: 'text-orange-400 bg-orange-900/20 border-orange-800' };
      case 'read_file':
      case 'list_directory':
        return { level: 'Low Risk', color: 'text-green-400 bg-green-900/20 border-green-800' };
      default:
        return { level: 'Unknown', color: 'text-gray-400 bg-gray-900/20 border-gray-800' };
    }
  };

  const risk = getRiskLevel(request.toolName);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-claude-dark-800 rounded-lg border border-claude-dark-600 max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-claude-dark-600">
          <div className="flex items-center space-x-3">
            {getToolIcon(request.toolName)}
            <div>
              <h2 className="text-lg font-semibold text-white">Tool Permission Request</h2>
              <p className="text-sm text-claude-dark-300">
                {requests.length > 1 && `${currentIndex + 1} of ${requests.length} • `}
                Worktree: {request.worktreeId}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-claude-dark-400 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 overflow-y-auto max-h-[60vh]">
          {/* Tool Info */}
          <div className="bg-claude-dark-700 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium text-white">{formatToolName(request.toolName)}</h3>
              <span className={`text-xs px-2 py-1 rounded border ${risk.color}`}>
                {risk.level}
              </span>
            </div>
            <p className="text-sm text-claude-dark-300">
              Claude wants to {request.toolName.replace(/_/g, ' ')} in your worktree.
            </p>
          </div>

          {/* Input Parameters */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-claude-dark-300">Parameters:</label>
            <textarea
              value={formatInput(inputModifications[approvalId] || request.input)}
              onChange={(e) => handleModifyInput(e.target.value)}
              className="w-full h-32 bg-claude-dark-700 border border-claude-dark-600 rounded text-white p-3 text-sm font-mono resize-none focus:outline-none focus:border-blue-500"
              placeholder="Tool parameters..."
            />
            <p className="text-xs text-claude-dark-400">
              You can modify these parameters before approving the request.
            </p>
          </div>

          {/* Timestamp */}
          <div className="text-xs text-claude-dark-400">
            Requested: {new Date(request.timestamp).toLocaleString()}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between p-4 border-t border-claude-dark-600 bg-claude-dark-750">
          <div className="flex space-x-2">
            {hasPrevious && (
              <button
                onClick={goToPrevious}
                className="px-3 py-1.5 text-sm bg-claude-dark-600 hover:bg-claude-dark-500 text-white rounded transition-colors"
              >
                Previous
              </button>
            )}
            {hasNext && (
              <button
                onClick={() => setCurrentIndex(prev => prev + 1)}
                className="px-3 py-1.5 text-sm bg-claude-dark-600 hover:bg-claude-dark-500 text-white rounded transition-colors"
              >
                Skip
              </button>
            )}
          </div>

          <div className="flex space-x-2">
            <button
              onClick={handleDeny}
              className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded transition-colors flex items-center space-x-2"
            >
              <XCircle size={16} />
              <span>Deny</span>
            </button>
            <button
              onClick={handleApprove}
              className="px-4 py-2 text-sm bg-green-600 hover:bg-green-700 text-white rounded transition-colors flex items-center space-x-2"
            >
              <CheckCircle size={16} />
              <span>Approve</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}