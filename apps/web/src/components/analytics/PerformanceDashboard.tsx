'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { LineChart, Line, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { TrendingUp, TrendingDown, Minus, Zap, DollarSign, Clock, Target, AlertTriangle, CheckCircle, Info } from 'lucide-react';
import { useWebSocket } from '@/hooks/useWebSocket';

interface PerformanceMetrics {
  realtime: {
    current: {
      tokenEfficiency: number;
      responseQuality: number;
      costPerRequest: number;
      responseTime: number;
      errorRate: number;
    };
    trends: {
      tokenEfficiency: string;
      responseQuality: string;
      costPerRequest: string;
      responseTime: string;
    };
    sparklines: {
      tokenEfficiency: number[];
      responseQuality: number[];
      cost: number[];
      responseTime: number[];
    };
  };
  tokenEfficiency: any;
  quality: any;
  cost: any;
  performance: any;
  modelComparison: any[];
  alerts: any[];
  optimizations: any[];
  summary: any;
}

interface OptimizationSuggestion {
  type: string;
  title: string;
  description: string;
  impact: 'low' | 'medium' | 'high';
  effort: 'low' | 'medium' | 'high';
  estimatedSavings: {
    tokens?: number;
    cost?: number;
    time?: number;
  };
  implementation: string;
  examples?: string[];
}

const MetricCard: React.FC<{
  title: string;
  value: number;
  format: 'percentage' | 'currency' | 'milliseconds' | 'number';
  trend?: string;
  sparkline?: number[];
  benchmark?: number;
  alert?: boolean;
}> = ({ title, value, format, trend, sparkline, benchmark, alert }) => {
  const formatValue = (val: number, fmt: string) => {
    switch (fmt) {
      case 'percentage':
        return `${(val * 100).toFixed(1)}%`;
      case 'currency':
        return `$${val.toFixed(4)}`;
      case 'milliseconds':
        return `${val.toFixed(0)}ms`;
      default:
        return val.toFixed(2);
    }
  };

  const getTrendIcon = (trendType: string) => {
    switch (trendType) {
      case 'increasing':
        return <TrendingUp className="h-4 w-4 text-green-500" />;
      case 'decreasing':
        return <TrendingDown className="h-4 w-4 text-red-500" />;
      default:
        return <Minus className="h-4 w-4 text-gray-500" />;
    }
  };

  return (
    <Card className={alert ? 'border-red-500' : ''}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {trend && getTrendIcon(trend)}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">
          {formatValue(value, format)}
        </div>
        
        {benchmark && (
          <div className="mt-2">
            <div className="text-xs text-muted-foreground mb-1">
              vs benchmark: {formatValue(benchmark, format)}
            </div>
            <Progress 
              value={(value / benchmark) * 100} 
              className="h-2"
            />
          </div>
        )}

        {sparkline && sparkline.length > 0 && (
          <div className="mt-3 h-[40px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkline.map((val, idx) => ({ value: val, index: idx }))}>
                <Line 
                  type="monotone" 
                  dataKey="value" 
                  stroke="#8884d8" 
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const OptimizationCard: React.FC<{ suggestion: OptimizationSuggestion }> = ({ suggestion }) => {
  const getImpactColor = (impact: string) => {
    switch (impact) {
      case 'high': return 'bg-red-100 text-red-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-green-100 text-green-800';
    }
  };

  const getEffortColor = (effort: string) => {
    switch (effort) {
      case 'high': return 'bg-red-100 text-red-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-green-100 text-green-800';
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{suggestion.title}</CardTitle>
          <div className="flex gap-2">
            <Badge className={getImpactColor(suggestion.impact)}>
              {suggestion.impact} impact
            </Badge>
            <Badge className={getEffortColor(suggestion.effort)}>
              {suggestion.effort} effort
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          {suggestion.description}
        </p>
        
        {suggestion.estimatedSavings && (
          <div className="bg-green-50 p-3 rounded-lg mb-4">
            <div className="text-sm font-medium text-green-800 mb-2">Estimated Savings:</div>
            <div className="grid grid-cols-3 gap-4 text-sm">
              {suggestion.estimatedSavings.tokens && (
                <div>
                  <div className="font-medium">{suggestion.estimatedSavings.tokens}</div>
                  <div className="text-green-600">tokens</div>
                </div>
              )}
              {suggestion.estimatedSavings.cost && (
                <div>
                  <div className="font-medium">${suggestion.estimatedSavings.cost.toFixed(2)}</div>
                  <div className="text-green-600">cost</div>
                </div>
              )}
              {suggestion.estimatedSavings.time && (
                <div>
                  <div className="font-medium">{suggestion.estimatedSavings.time}%</div>
                  <div className="text-green-600">time</div>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="space-y-3">
          <div>
            <div className="text-sm font-medium mb-1">Implementation:</div>
            <div className="text-sm text-muted-foreground">{suggestion.implementation}</div>
          </div>
          
          {suggestion.examples && suggestion.examples.length > 0 && (
            <div>
              <div className="text-sm font-medium mb-1">Examples:</div>
              <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                {suggestion.examples.map((example, idx) => (
                  <li key={idx}>{example}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <Button className="w-full mt-4" variant="outline">
          Apply Optimization
        </Button>
      </CardContent>
    </Card>
  );
};

const ModelComparisonChart: React.FC<{ models: any[] }> = ({ models }) => {
  const data = models.map(model => ({
    name: model.model,
    quality: model.quality * 100,
    cost: model.cost * 1000, // Scale for visibility
    responseTime: model.responseTime / 100, // Scale for visibility
    efficiency: model.efficiency * 100,
    score: model.score * 100
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Model Performance Comparison</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="quality" fill="#8884d8" name="Quality %" />
            <Bar dataKey="efficiency" fill="#82ca9d" name="Efficiency %" />
            <Bar dataKey="score" fill="#ffc658" name="Overall Score %" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
};

const AlertsPanel: React.FC<{ alerts: any[] }> = ({ alerts }) => {
  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <AlertTriangle className="h-4 w-4 text-red-500" />;
      case 'high':
        return <AlertTriangle className="h-4 w-4 text-orange-500" />;
      case 'medium':
        return <Info className="h-4 w-4 text-yellow-500" />;
      default:
        return <CheckCircle className="h-4 w-4 text-green-500" />;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active Alerts</CardTitle>
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <CheckCircle className="h-12 w-12 mx-auto mb-4 text-green-500" />
            <p>No active alerts</p>
          </div>
        ) : (
          <div className="space-y-4">
            {alerts.map((alert, idx) => (
              <Alert key={idx}>
                <div className="flex items-start gap-3">
                  {getSeverityIcon(alert.severity)}
                  <div className="flex-1">
                    <AlertTitle className="capitalize">{alert.type.replace('_', ' ')}</AlertTitle>
                    <AlertDescription>{alert.message}</AlertDescription>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {new Date(alert.timestamp).toLocaleString()}
                    </div>
                  </div>
                  <Button size="sm" variant="outline">
                    Resolve
                  </Button>
                </div>
              </Alert>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export const PerformanceDashboard: React.FC = () => {
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);
  const [timeRange, setTimeRange] = useState('1h');
  const [loading, setLoading] = useState(true);

  // WebSocket connection for real-time updates
  const { data: realtimeData } = useWebSocket('/performance', {
    onMessage: (data) => {
      if (data.type === 'metrics_update') {
        setMetrics(prev => prev ? {
          ...prev,
          realtime: data.metrics
        } : null);
      }
    }
  });

  useEffect(() => {
    fetchDashboardData();
  }, [timeRange]);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/performance/dashboard?timeRange=${timeRange}`);
      const data = await response.json();
      setMetrics(data);
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !metrics) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Performance Dashboard</h1>
          <p className="text-muted-foreground">
            Monitor and optimize your prompt performance in real-time
          </p>
        </div>
        
        <div className="flex items-center gap-4">
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1h">Last Hour</SelectItem>
              <SelectItem value="24h">Last 24h</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
            </SelectContent>
          </Select>
          
          <Button onClick={fetchDashboardData} variant="outline">
            Refresh
          </Button>
        </div>
      </div>

      {/* Real-time Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <MetricCard
          title="Token Efficiency"
          value={metrics.realtime.current.tokenEfficiency}
          format="percentage"
          trend={metrics.realtime.trends.tokenEfficiency}
          sparkline={metrics.realtime.sparklines.tokenEfficiency}
          benchmark={0.7}
        />
        
        <MetricCard
          title="Response Quality"
          value={metrics.realtime.current.responseQuality}
          format="percentage"
          trend={metrics.realtime.trends.responseQuality}
          sparkline={metrics.realtime.sparklines.responseQuality}
          benchmark={0.85}
        />
        
        <MetricCard
          title="Cost per Request"
          value={metrics.realtime.current.costPerRequest}
          format="currency"
          trend={metrics.realtime.trends.costPerRequest}
          sparkline={metrics.realtime.sparklines.cost}
          alert={metrics.realtime.current.costPerRequest > 0.05}
        />
        
        <MetricCard
          title="Response Time"
          value={metrics.realtime.current.responseTime}
          format="milliseconds"
          trend={metrics.realtime.trends.responseTime}
          sparkline={metrics.realtime.sparklines.responseTime}
        />
        
        <MetricCard
          title="Error Rate"
          value={metrics.realtime.current.errorRate}
          format="percentage"
          trend="stable"
          alert={metrics.realtime.current.errorRate > 0.05}
        />
      </div>

      {/* Main Content Tabs */}
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="efficiency">Token Efficiency</TabsTrigger>
          <TabsTrigger value="quality">Quality</TabsTrigger>
          <TabsTrigger value="cost">Cost Analysis</TabsTrigger>
          <TabsTrigger value="models">Model Comparison</TabsTrigger>
          <TabsTrigger value="optimizations">Optimizations</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Summary Stats */}
            <Card>
              <CardHeader>
                <CardTitle>Summary Statistics</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between">
                    <span>Total Requests</span>
                    <span className="font-medium">{metrics.summary.totalRequests?.toLocaleString() || '0'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Total Cost</span>
                    <span className="font-medium">${metrics.summary.totalCost?.toFixed(2) || '0.00'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Average Quality</span>
                    <span className="font-medium">{((metrics.summary.averageQuality || 0) * 100).toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Average Efficiency</span>
                    <span className="font-medium">{((metrics.summary.averageEfficiency || 0) * 100).toFixed(1)}%</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Alerts Panel */}
            <AlertsPanel alerts={metrics.alerts} />
          </div>

          {/* Model Comparison Chart */}
          <ModelComparisonChart models={metrics.modelComparison} />
        </TabsContent>

        <TabsContent value="efficiency" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Token Efficiency Over Time</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={metrics.tokenEfficiency?.timeSeries || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="timestamp" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="efficiency" stroke="#8884d8" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Token Waste Analysis</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between text-sm">
                      <span>Total Tokens</span>
                      <span>{metrics.tokenEfficiency?.totalTokens?.toLocaleString() || '0'}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>Wasted Tokens</span>
                      <span className="text-red-600">{metrics.tokenEfficiency?.wastedTokens?.toLocaleString() || '0'}</span>
                    </div>
                    <div className="flex justify-between text-sm font-medium">
                      <span>Waste Percentage</span>
                      <span className="text-red-600">{metrics.tokenEfficiency?.wastePercentage?.toFixed(1) || '0'}%</span>
                    </div>
                  </div>
                  
                  <Progress 
                    value={100 - (metrics.tokenEfficiency?.wastePercentage || 0)} 
                    className="h-3"
                  />
                  
                  <div className="text-sm text-muted-foreground">
                    Efficiency: {((1 - (metrics.tokenEfficiency?.wastePercentage || 0) / 100) * 100).toFixed(1)}%
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="quality" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Quality Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {['accuracy', 'relevance', 'completeness', 'clarity'].map((dimension) => (
                    <div key={dimension} className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="capitalize">{dimension}</span>
                        <span>{((metrics.quality?.breakdown?.[dimension] || 0) * 100).toFixed(1)}%</span>
                      </div>
                      <Progress value={(metrics.quality?.breakdown?.[dimension] || 0) * 100} className="h-2" />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Quality by Model</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={metrics.quality?.modelQuality || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="model" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="quality" fill="#8884d8" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="cost" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5" />
                  Cost Overview
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <div className="text-2xl font-bold">${metrics.cost?.totalCost?.toFixed(2) || '0.00'}</div>
                    <div className="text-sm text-muted-foreground">Total cost this period</div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold">${metrics.cost?.averageCostPerRequest?.toFixed(4) || '0.0000'}</div>
                    <div className="text-sm text-muted-foreground">Average per request</div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold">${metrics.cost?.projectedMonthlyCost?.toFixed(2) || '0.00'}</div>
                    <div className="text-sm text-muted-foreground">Projected monthly</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Cost by Model</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={metrics.cost?.modelCosts || []}
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="totalCost"
                      label={({ model, totalCost }) => `${model}: $${totalCost.toFixed(2)}`}
                    >
                      {(metrics.cost?.modelCosts || []).map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={`hsl(${index * 45}, 70%, 60%)`} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="models" className="space-y-6">
          <ModelComparisonChart models={metrics.modelComparison} />
          
          <Card>
            <CardHeader>
              <CardTitle>Model Performance Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Model</th>
                      <th className="text-left p-2">Requests</th>
                      <th className="text-left p-2">Quality</th>
                      <th className="text-left p-2">Avg Cost</th>
                      <th className="text-left p-2">Response Time</th>
                      <th className="text-left p-2">Efficiency</th>
                      <th className="text-left p-2">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.modelComparison.map((model, idx) => (
                      <tr key={idx} className="border-b">
                        <td className="p-2 font-medium">{model.model}</td>
                        <td className="p-2">{model.requests.toLocaleString()}</td>
                        <td className="p-2">{(model.quality * 100).toFixed(1)}%</td>
                        <td className="p-2">${model.cost.toFixed(4)}</td>
                        <td className="p-2">{model.responseTime.toFixed(0)}ms</td>
                        <td className="p-2">{(model.efficiency * 100).toFixed(1)}%</td>
                        <td className="p-2">
                          <Badge variant={model.score > 0.8 ? 'default' : model.score > 0.6 ? 'secondary' : 'destructive'}>
                            {(model.score * 100).toFixed(0)}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="optimizations" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {metrics.optimizations.map((suggestion, idx) => (
              <OptimizationCard key={idx} suggestion={suggestion} />
            ))}
          </div>
          
          {metrics.optimizations.length === 0 && (
            <Card>
              <CardContent className="text-center py-12">
                <CheckCircle className="h-12 w-12 mx-auto mb-4 text-green-500" />
                <h3 className="text-lg font-semibold mb-2">All Optimized!</h3>
                <p className="text-muted-foreground">
                  Your prompts are performing well. Check back later for new optimization opportunities.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};