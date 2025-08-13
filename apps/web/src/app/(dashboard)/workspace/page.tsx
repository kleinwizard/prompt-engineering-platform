'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PromptEditor } from '@/components/workspace/PromptEditor';
import { ModelSelector } from '@/components/workspace/ModelSelector';
import { CoachPanel } from '@/components/workspace/CoachPanel';
import { OutputViewer } from '@/components/workspace/OutputViewer';
import { MetricsPanel } from '@/components/workspace/MetricsPanel';
import { HistoryPanel } from '@/components/workspace/HistoryPanel';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useAuth } from '@/hooks/useAuth';
import { useWebSocket } from '@/hooks/useWebSocket';
import { Play, Save, Share2, Download, Sparkles, TrendingUp } from 'lucide-react';

export default function WorkspacePage() {
  const { user } = useAuth();
  const { socket } = useWebSocket();
  const queryClient = useQueryClient();
  
  const [originalPrompt, setOriginalPrompt] = useState('');
  const [improvedPrompt, setImprovedPrompt] = useState('');
  const [selectedModel, setSelectedModel] = useState('gpt-4');
  const [output, setOutput] = useState('');
  const [isImproving, setIsImproving] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [showDiff, setShowDiff] = useState(true);
  
  const {
    improvePrompt,
    executePrompt,
    savePrompt,
    getPromptHistory,
    metrics,
    coachingTips,
  } = useWorkspace();

  // Real-time collaboration
  useEffect(() => {
    if (socket && user) {
      socket.emit('join-workspace', user.id);
      
      socket.on('prompt-updated', (data) => {
        if (data.userId !== user.id) {
          setOriginalPrompt(data.prompt);
        }
      });

      return () => {
        socket.off('prompt-updated');
      };
    }
  }, [socket, user]);

  const handleImprovePrompt = useCallback(async () => {
    if (!originalPrompt.trim()) return;
    
    setIsImproving(true);
    try {
      const result = await improvePrompt({
        prompt: originalPrompt,
        model: selectedModel,
        userId: user?.id,
      });
      
      setImprovedPrompt(result.improvedPrompt);
      
      // Real-time update
      socket?.emit('prompt-improved', {
        userId: user?.id,
        original: originalPrompt,
        improved: result.improvedPrompt,
        metrics: result.metrics,
      });
      
    } catch (error) {
      console.error('Failed to improve prompt:', error);
    } finally {
      setIsImproving(false);
    }
  }, [originalPrompt, selectedModel, user?.id, improvePrompt, socket]);

  const handleExecutePrompt = useCallback(async () => {
    const promptToExecute = improvedPrompt || originalPrompt;
    if (!promptToExecute.trim()) return;
    
    setIsExecuting(true);
    try {
      const result = await executePrompt({
        prompt: promptToExecute,
        model: selectedModel,
        userId: user?.id,
      });
      
      setOutput(result.output);
      
    } catch (error) {
      console.error('Failed to execute prompt:', error);
    } finally {
      setIsExecuting(false);
    }
  }, [improvedPrompt, originalPrompt, selectedModel, user?.id, executePrompt]);

  const handleSavePrompt = useCallback(async () => {
    if (!originalPrompt.trim()) return;
    
    await savePrompt({
      original: originalPrompt,
      improved: improvedPrompt,
      output,
      model: selectedModel,
      userId: user?.id,
    });
  }, [originalPrompt, improvedPrompt, output, selectedModel, user?.id, savePrompt]);

  return (
    <div className="workspace-layout p-4">
      {/* Left Panel - Input */}
      <div className="col-span-4">
        <Card className="workspace-panel h-full">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <span>Your Prompt</span>
              <Badge variant="secondary" className="text-xs">
                {originalPrompt.length} characters
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 h-full">
            <PromptEditor
              value={originalPrompt}
              onChange={setOriginalPrompt}
              placeholder="Enter your prompt here..."
              className="flex-1 min-h-[300px]"
            />
            
            <div className="flex gap-2">
              <ModelSelector
                value={selectedModel}
                onChange={setSelectedModel}
                className="flex-1"
              />
              <Button 
                onClick={handleImprovePrompt}
                disabled={!originalPrompt.trim() || isImproving}
                className="gap-2"
              >
                <Sparkles className="w-4 h-4" />
                {isImproving ? 'Improving...' : 'Improve'}
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button 
                onClick={handleExecutePrompt}
                disabled={!originalPrompt.trim() || isExecuting}
                className="gap-2"
                variant="outline"
              >
                <Play className="w-4 h-4" />
                {isExecuting ? 'Running...' : 'Run'}
              </Button>
              <Button 
                onClick={handleSavePrompt}
                disabled={!originalPrompt.trim()}
                className="gap-2"
                variant="outline"
              >
                <Save className="w-4 h-4" />
                Save
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Center Panel - Improved Prompt & Output */}
      <div className="col-span-5">
        <Card className="workspace-panel h-full">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <span>Enhanced Prompt</span>
                {improvedPrompt && (
                  <Badge variant="default" className="text-xs">
                    <TrendingUp className="w-3 h-3 mr-1" />
                    Improved
                  </Badge>
                )}
              </CardTitle>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowDiff(!showDiff)}
                >
                  {showDiff ? 'Clean View' : 'Show Changes'}
                </Button>
                <Button size="sm" variant="outline" className="gap-2">
                  <Share2 className="w-3 h-3" />
                  Share
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="h-full flex flex-col">
            <Tabs defaultValue="prompt" className="flex-1 flex flex-col">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="prompt">Improved Prompt</TabsTrigger>
                <TabsTrigger value="output">Output</TabsTrigger>
              </TabsList>
              
              <TabsContent value="prompt" className="flex-1">
                <ScrollArea className="h-full">
                  <div className="space-y-4">
                    {improvedPrompt ? (
                      <div className="p-4 border rounded-lg bg-muted/50">
                        <pre className="whitespace-pre-wrap text-sm syntax-highlight">
                          {improvedPrompt}
                        </pre>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-40 text-muted-foreground">
                        Click "Improve" to enhance your prompt
                      </div>
                    )}
                    
                    {/* Diff View */}
                    {showDiff && improvedPrompt && originalPrompt && (
                      <div className="space-y-2">
                        <h4 className="font-medium text-sm">Changes Made:</h4>
                        <div className="p-3 border rounded-lg bg-green-50 dark:bg-green-900/20">
                          <p className="text-sm text-green-700 dark:text-green-300">
                            ✓ Enhanced structure and clarity
                          </p>
                          <p className="text-sm text-green-700 dark:text-green-300">
                            ✓ Added specific role definition
                          </p>
                          <p className="text-sm text-green-700 dark:text-green-300">
                            ✓ Included output format requirements
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>
              
              <TabsContent value="output" className="flex-1">
                <OutputViewer
                  output={output}
                  isLoading={isExecuting}
                  model={selectedModel}
                  className="h-full"
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      {/* Right Panel - Coach & Tools */}
      <div className="col-span-3">
        <div className="flex flex-col gap-4 h-full">
          <CoachPanel
            tips={coachingTips}
            metrics={metrics}
            className="flex-1"
          />
          
          <MetricsPanel
            metrics={metrics}
            className="flex-shrink-0"
          />
          
          <HistoryPanel
            className="flex-shrink-0 max-h-60"
          />
        </div>
      </div>
    </div>
  );
}