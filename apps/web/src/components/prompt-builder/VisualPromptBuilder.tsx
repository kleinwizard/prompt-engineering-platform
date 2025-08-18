'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';

interface PromptBlock {
  id: string;
  type: 'role' | 'context' | 'task' | 'constraints' | 'format' | 'examples' | 'custom';
  content: string;
  config: {
    variables: Record<string, string>;
    validation?: any;
    styling?: {
      color: string;
      icon: string;
      priority: number;
    };
  };
  position: number;
}

interface BlockTemplate {
  type: string;
  name: string;
  icon: string;
  template: string;
  variables: string[];
  color: string;
  category: string;
  description: string;
  examples: string[];
}

const blockTemplates: Record<string, BlockTemplate> = {
  role: {
    type: 'role',
    name: 'Role Definition',
    icon: '👤',
    template: 'You are a {{ROLE}} with expertise in {{EXPERTISE}}.',
    variables: ['ROLE', 'EXPERTISE'],
    color: '#3B82F6',
    category: 'foundation',
    description: 'Define the AI\'s role and expertise areas',
    examples: ['You are a senior software engineer with expertise in React.']
  },
  context: {
    type: 'context',
    name: 'Context Setting',
    icon: '📋',
    template: 'Context: {{CONTEXT}}\nBackground: {{BACKGROUND}}',
    variables: ['CONTEXT', 'BACKGROUND'],
    color: '#10B981',
    category: 'foundation',
    description: 'Provide essential background information',
    examples: ['Context: We are developing a new mobile app.']
  },
  task: {
    type: 'task',
    name: 'Task Definition',
    icon: '🎯',
    template: 'Your task is to {{TASK}}.\nGoal: {{GOAL}}',
    variables: ['TASK', 'GOAL'],
    color: '#8B5CF6',
    category: 'core',
    description: 'Define the specific task and objectives',
    examples: ['Your task is to analyze the user interface.']
  },
  constraints: {
    type: 'constraints',
    name: 'Constraints',
    icon: '⚠️',
    template: 'Constraints:\n- {{CONSTRAINT_1}}\n- {{CONSTRAINT_2}}',
    variables: ['CONSTRAINT_1', 'CONSTRAINT_2'],
    color: '#F59E0B',
    category: 'guidelines',
    description: 'Set boundaries and limitations',
    examples: ['Keep response under 500 words']
  },
  format: {
    type: 'format',
    name: 'Output Format',
    icon: '📝',
    template: 'Format: {{FORMAT_STRUCTURE}}',
    variables: ['FORMAT_STRUCTURE'],
    color: '#EC4899',
    category: 'output',
    description: 'Specify desired output format',
    examples: ['Format as a numbered list']
  },
  examples: {
    type: 'examples',
    name: 'Examples',
    icon: '💡',
    template: 'Example:\nInput: {{EXAMPLE_INPUT}}\nOutput: {{EXAMPLE_OUTPUT}}',
    variables: ['EXAMPLE_INPUT', 'EXAMPLE_OUTPUT'],
    color: '#F59E0B',
    category: 'guidance',
    description: 'Provide concrete examples',
    examples: ['Show before/after code examples']
  }
};

const BlockPalette: React.FC<{ onDrop: (template: BlockTemplate) => void }> = ({ onDrop }) => {
  const categories = {
    foundation: ['role', 'context'],
    core: ['task'],
    guidelines: ['constraints'],
    output: ['format'],
    guidance: ['examples']
  };

  return (
    <div className="w-64 bg-gray-50 border-r border-gray-200 p-4 overflow-y-auto">
      <h3 className="text-lg font-semibold mb-4">Block Palette</h3>
      
      {Object.entries(categories).map(([category, types]) => (
        <div key={category} className="mb-6">
          <h4 className="text-sm font-medium text-gray-700 mb-2 capitalize">
            {category}
          </h4>
          <div className="space-y-2">
            {types.map(type => {
              const template = blockTemplates[type];
              return (
                <DraggableBlock
                  key={type}
                  template={template}
                  onDrop={onDrop}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

const DraggableBlock: React.FC<{
  template: BlockTemplate;
  onDrop: (template: BlockTemplate) => void;
}> = ({ template, onDrop }) => {
  const [{ isDragging }, drag] = useDrag({
    type: 'block-template',
    item: { template },
    collect: (monitor) => ({
      isDragging: monitor.isDragging()
    })
  });

  return (
    <div
      ref={drag}
      className={`p-3 rounded-lg border-2 border-dashed cursor-move transition-all ${
        isDragging ? 'opacity-50' : 'opacity-100 hover:shadow-md'
      }`}
      style={{
        backgroundColor: template.color + '20',
        borderColor: template.color
      }}
      onClick={() => onDrop(template)}
    >
      <div className="flex items-center space-x-2">
        <span className="text-lg">{template.icon}</span>
        <div>
          <div className="font-medium text-sm">{template.name}</div>
          <div className="text-xs text-gray-600">{template.description}</div>
        </div>
      </div>
    </div>
  );
};

const DropZone: React.FC<{
  index: number;
  onDrop: (template: BlockTemplate, index: number) => void;
}> = ({ index, onDrop }) => {
  const [{ isOver }, drop] = useDrop({
    accept: 'block-template',
    drop: (item: { template: BlockTemplate }) => {
      onDrop(item.template, index);
    },
    collect: (monitor) => ({
      isOver: monitor.isOver()
    })
  });

  return (
    <div
      ref={drop}
      className={`h-12 border-2 border-dashed rounded-lg transition-all ${
        isOver 
          ? 'border-blue-400 bg-blue-50' 
          : 'border-gray-300 bg-gray-50'
      }`}
    >
      <div className="flex items-center justify-center h-full text-sm text-gray-500">
        {isOver ? 'Drop block here' : 'Drop zone'}
      </div>
    </div>
  );
};

const PromptBlockComponent: React.FC<{
  block: PromptBlock;
  onUpdate: (block: PromptBlock) => void;
  onDelete: () => void;
  onMove: (dragIndex: number, hoverIndex: number) => void;
  index: number;
}> = ({ block, onUpdate, onDelete, onMove, index }) => {
  const template = blockTemplates[block.type];
  const ref = useRef<HTMLDivElement>(null);

  const [{ isDragging }, drag] = useDrag({
    type: 'block',
    item: { index },
    collect: (monitor) => ({
      isDragging: monitor.isDragging()
    })
  });

  const [, drop] = useDrop({
    accept: 'block',
    hover: (item: { index: number }) => {
      if (item.index !== index) {
        onMove(item.index, index);
        item.index = index;
      }
    }
  });

  drag(drop(ref));

  const updateVariable = (variable: string, value: string) => {
    const updatedBlock = {
      ...block,
      config: {
        ...block.config,
        variables: {
          ...block.config.variables,
          [variable]: value
        }
      }
    };
    onUpdate(updatedBlock);
  };

  return (
    <div
      ref={ref}
      className={`bg-white border-2 rounded-lg p-4 shadow-sm transition-all ${
        isDragging ? 'opacity-50' : 'opacity-100'
      }`}
      style={{ borderColor: template.color }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <span className="text-lg">{template.icon}</span>
          <div>
            <div className="font-medium">{template.name}</div>
            <div className="text-xs text-gray-500">{template.category}</div>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={onDelete}
            className="text-gray-400 hover:text-red-500 transition-colors"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {template.variables.map(variable => (
          <div key={variable}>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {variable.replace(/_/g, ' ')}
            </label>
            <textarea
              value={block.config.variables[variable] || ''}
              onChange={(e) => updateVariable(variable, e.target.value)}
              placeholder={`Enter ${variable.toLowerCase()}`}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              rows={2}
            />
          </div>
        ))}
      </div>

      <div className="mt-3 p-2 bg-gray-50 rounded text-xs text-gray-600">
        <div className="font-medium mb-1">Preview:</div>
        <div className="whitespace-pre-wrap">
          {template.template.replace(/{{([^}]+)}}/g, (match, variable) => {
            const value = block.config.variables[variable];
            return value || `[${variable}]`;
          })}
        </div>
      </div>
    </div>
  );
};

const PromptPreview: React.FC<{ prompt: string }> = ({ prompt }) => {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const stats = {
    wordCount: prompt.split(' ').length,
    characterCount: prompt.length,
    lineCount: prompt.split('\n').length,
    estimatedTokens: Math.ceil(prompt.length / 4)
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold">Prompt Preview</h3>
        <button
          onClick={copyToClipboard}
          className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 transition-colors"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-4 text-sm">
        <div className="text-center">
          <div className="font-medium">{stats.wordCount}</div>
          <div className="text-gray-500">Words</div>
        </div>
        <div className="text-center">
          <div className="font-medium">{stats.characterCount}</div>
          <div className="text-gray-500">Characters</div>
        </div>
        <div className="text-center">
          <div className="font-medium">{stats.lineCount}</div>
          <div className="text-gray-500">Lines</div>
        </div>
        <div className="text-center">
          <div className="font-medium">{stats.estimatedTokens}</div>
          <div className="text-gray-500">Est. Tokens</div>
        </div>
      </div>

      <div className="bg-gray-50 border rounded p-3 max-h-96 overflow-y-auto">
        <pre className="whitespace-pre-wrap text-sm font-mono">{prompt}</pre>
      </div>
    </div>
  );
};

export const VisualPromptBuilder: React.FC = () => {
  const [blocks, setBlocks] = useState<PromptBlock[]>([]);
  const [preview, setPreview] = useState('');
  const [blueprintName, setBlueprintName] = useState('');
  const [blueprintDescription, setBlueprintDescription] = useState('');

  const generateBlockId = () => `block_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const handleDrop = useCallback((template: BlockTemplate, index: number) => {
    const newBlock: PromptBlock = {
      id: generateBlockId(),
      type: template.type as any,
      content: template.template,
      config: {
        variables: {},
        styling: {
          color: template.color,
          icon: template.icon,
          priority: index
        }
      },
      position: index
    };

    setBlocks(prev => {
      const updated = [...prev];
      updated.splice(index, 0, newBlock);
      return updated.map((block, i) => ({ ...block, position: i }));
    });
  }, []);

  const updateBlock = useCallback((blockId: string, updatedBlock: PromptBlock) => {
    setBlocks(prev => prev.map(block => 
      block.id === blockId ? updatedBlock : block
    ));
  }, []);

  const deleteBlock = useCallback((blockId: string) => {
    setBlocks(prev => prev.filter(block => block.id !== blockId));
  }, []);

  const moveBlock = useCallback((dragIndex: number, hoverIndex: number) => {
    setBlocks(prev => {
      const updated = [...prev];
      const draggedBlock = updated[dragIndex];
      updated.splice(dragIndex, 1);
      updated.splice(hoverIndex, 0, draggedBlock);
      return updated.map((block, i) => ({ ...block, position: i }));
    });
  }, []);

  const generatePrompt = useCallback(() => {
    let prompt = '';
    const sortedBlocks = [...blocks].sort((a, b) => a.position - b.position);

    for (const block of sortedBlocks) {
      const template = blockTemplates[block.type];
      if (!template) continue;

      let blockContent = template.template;
      
      for (const variable of template.variables) {
        const value = block.config.variables[variable] || `[${variable}]`;
        blockContent = blockContent.replace(
          new RegExp(`{{${variable}}}`, 'g'),
          value
        );
      }

      if (prompt) prompt += '\n\n';
      prompt += blockContent;
    }

    return prompt;
  }, [blocks]);

  useEffect(() => {
    setPreview(generatePrompt());
  }, [blocks, generatePrompt]);

  const saveBlueprint = async () => {
    if (!blueprintName) {
      alert('Please enter a blueprint name');
      return;
    }

    try {
      const response = await fetch('/api/prompt-builder/blueprints', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          name: blueprintName,
          description: blueprintDescription,
          blocks,
          isPublic: false
        })
      });

      if (response.ok) {
        alert('Blueprint saved successfully!');
        setBlueprintName('');
        setBlueprintDescription('');
      } else {
        alert('Failed to save blueprint');
      }
    } catch (error) {
      console.error('Error saving blueprint:', error);
      alert('Error saving blueprint');
    }
  };

  const clearAll = () => {
    if (confirm('Are you sure you want to clear all blocks?')) {
      setBlocks([]);
    }
  };

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="h-screen flex bg-gray-100">
        <BlockPalette onDrop={(template) => handleDrop(template, blocks.length)} />
        
        <div className="flex-1 flex flex-col">
          {/* Header */}
          <div className="bg-white border-b border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold">Visual Prompt Builder</h1>
                <p className="text-gray-600">Drag and drop blocks to create your prompt</p>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={clearAll}
                  className="px-4 py-2 text-gray-600 hover:text-red-600 transition-colors"
                >
                  Clear All
                </button>
                <button
                  onClick={saveBlueprint}
                  className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                >
                  Save Blueprint
                </button>
              </div>
            </div>
          </div>

          <div className="flex-1 flex">
            {/* Builder Canvas */}
            <div className="flex-1 p-4 overflow-y-auto">
              <div className="max-w-4xl mx-auto space-y-4">
                {/* Blueprint Info */}
                <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Blueprint Name
                      </label>
                      <input
                        type="text"
                        value={blueprintName}
                        onChange={(e) => setBlueprintName(e.target.value)}
                        placeholder="Enter blueprint name"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Description
                      </label>
                      <input
                        type="text"
                        value={blueprintDescription}
                        onChange={(e) => setBlueprintDescription(e.target.value)}
                        placeholder="Enter description"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Drop Zones and Blocks */}
                <DropZone index={0} onDrop={handleDrop} />
                
                {blocks.map((block, index) => (
                  <React.Fragment key={block.id}>
                    <PromptBlockComponent
                      block={block}
                      onUpdate={(updatedBlock) => updateBlock(block.id, updatedBlock)}
                      onDelete={() => deleteBlock(block.id)}
                      onMove={moveBlock}
                      index={index}
                    />
                    <DropZone index={index + 1} onDrop={handleDrop} />
                  </React.Fragment>
                ))}

                {blocks.length === 0 && (
                  <div className="text-center py-12 text-gray-500">
                    <div className="text-4xl mb-4">🎯</div>
                    <h3 className="text-lg font-medium mb-2">Start Building Your Prompt</h3>
                    <p>Drag blocks from the palette or click on them to add to your prompt</p>
                  </div>
                )}
              </div>
            </div>

            {/* Preview Panel */}
            <div className="w-96 border-l border-gray-200 bg-white p-4 overflow-y-auto">
              <PromptPreview prompt={preview} />
            </div>
          </div>
        </div>
      </div>
    </DndProvider>
  );
};