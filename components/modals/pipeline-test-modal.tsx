'use client'

import { useState, useEffect } from 'react'
import { X, Play, CheckCircle2, AlertCircle, Loader, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

interface PipelineTestModalProps {
  isOpen: boolean
  pipelineName: string
  sourceType: string
  onClose: () => void
  onSuccess: () => void
}

interface ExecutionStep {
  name: string
  status: 'pending' | 'running' | 'success' | 'error'
  duration?: number
  details?: string[]
}

export default function PipelineTestModal({
  isOpen,
  pipelineName,
  sourceType,
  onClose,
  onSuccess,
}: PipelineTestModalProps) {
  const [isRunning, setIsRunning] = useState(false)
  const [steps, setSteps] = useState<ExecutionStep[]>([
    { name: 'Validate Configuration', status: 'pending' },
    { name: 'Connect to Source', status: 'pending' },
    { name: 'Fetch Sample Data', status: 'pending' },
    { name: 'Apply Transformations', status: 'pending' },
    { name: 'Create Destination Schema', status: 'pending' },
    { name: 'Map Columns', status: 'pending' },
    { name: 'Insert Test Records', status: 'pending' },
    { name: 'Verify Output', status: 'pending' },
  ])
  const [expandedStep, setExpandedStep] = useState(0)
  const [testResult, setTestResult] = useState<any>(null)

  const runTest = async () => {
    setIsRunning(true)
    let currentStep = 0

    const stepDetails: Record<string, string[]> = {
      'Validate Configuration': [
        'Pipeline name: ' + pipelineName,
        'Source type: ' + sourceType,
        'Destination: Oracle Database',
        'Schedule: Manual',
        'Status: Configuration valid ✓',
      ],
      'Connect to Source': [
        'Connecting to ' + sourceType + ' at host: api.datasource.com',
        'Authentication: Bearer token',
        'Connection timeout: 30s',
        'Status: Connected ✓',
      ],
      'Fetch Sample Data': [
        'Query: SELECT * FROM source_table LIMIT 1000',
        'Records retrieved: 1,247',
        'Data size: 2.3 MB',
        'Status: Sample data loaded ✓',
      ],
      'Apply Transformations': [
        'Transformation 1: Uppercase customer names',
        'Transformation 2: Convert date format (YYYY-MM-DD)',
        'Transformation 3: Round amounts to 2 decimals',
        'Status: 3 transformations applied ✓',
      ],
      'Create Destination Schema': [
        'Creating table: sales_orders',
        'Fields: 8 columns',
        'Primary key: order_id',
        'Status: Schema created ✓',
      ],
      'Map Columns': [
        'Source.order_id → Destination.order_id',
        'Source.customer → Destination.customer_name',
        'Source.amount → Destination.total_amount',
        'Mapping complete: 8/8 columns ✓',
      ],
      'Insert Test Records': [
        'Inserting 1,247 test records...',
        'Batch size: 500 records/batch',
        'Total batches: 3',
        'Status: All records inserted ✓',
      ],
      'Verify Output': [
        'Verification queries executed',
        'Row count verified: 1,247 rows',
        'Data integrity check: PASSED',
        'Performance check: 2.3s for full pipeline ✓',
      ],
    }

    for (let i = 0; i < steps.length; i++) {
      await new Promise((resolve) => {
        setTimeout(() => {
          setSteps((prevSteps) => {
            const newSteps = [...prevSteps]
            if (i < steps.length - 1) {
              newSteps[i] = {
                ...newSteps[i],
                status: 'success',
                duration: Math.floor(Math.random() * 3000) + 500,
                details: stepDetails[newSteps[i].name],
              }
              newSteps[i + 1] = { ...newSteps[i + 1], status: 'running' }
            } else {
              newSteps[i] = {
                ...newSteps[i],
                status: 'success',
                duration: Math.floor(Math.random() * 3000) + 500,
                details: stepDetails[newSteps[i].name],
              }
            }
            return newSteps
          })
          resolve(null)
        }, 1500)
      })
    }

    setTestResult({
      recordsProcessed: 1247,
      recordsSuccess: 1247,
      recordsFailed: 0,
      duration: '8.5s',
      status: 'SUCCESS',
    })
    setIsRunning(false)
  }

  if (!isOpen) return null

  const successCount = steps.filter((s) => s.status === 'success').length
  const allComplete = successCount === steps.length

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-lg border border-border max-w-2xl w-full max-h-[90vh] overflow-auto">
        <div className="sticky top-0 bg-card border-b border-border p-6 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Test Pipeline</h3>
            <p className="text-sm text-muted-foreground mt-1">{pipelineName}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} disabled={isRunning}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="p-6 space-y-6">
          {!testResult && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Run a test execution to validate your pipeline configuration, verify data transformations, and test the column mappings against live sample data.
              </p>

              <Button onClick={runTest} disabled={isRunning} className="w-full">
                <Play className="w-4 h-4 mr-2" />
                {isRunning ? 'Running Test...' : 'Start Test Run'}
              </Button>
            </div>
          )}

          {(isRunning || testResult) && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold">Execution Steps</h4>
                <span className="text-sm text-muted-foreground">
                  {successCount}/{steps.length} completed
                </span>
              </div>

              <div className="space-y-2">
                {steps.map((step, idx) => (
                  <div key={idx} className="border border-border/50 rounded-lg overflow-hidden">
                    <button
                      onClick={() => setExpandedStep(expandedStep === idx ? -1 : idx)}
                      className="w-full flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex-shrink-0">
                        {step.status === 'success' && (
                          <CheckCircle2 className="w-5 h-5 text-green-600" />
                        )}
                        {step.status === 'running' && (
                          <Loader className="w-5 h-5 text-blue-600 animate-spin" />
                        )}
                        {step.status === 'pending' && (
                          <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/30" />
                        )}
                        {step.status === 'error' && (
                          <AlertCircle className="w-5 h-5 text-red-600" />
                        )}
                      </div>
                      <div className="flex-1 text-left">
                        <div className="font-medium text-sm">{step.name}</div>
                        {step.duration && (
                          <div className="text-xs text-muted-foreground">
                            {step.duration}ms
                          </div>
                        )}
                      </div>
                      {step.details && (
                        <div className="flex-shrink-0">
                          {expandedStep === idx ? (
                            <ChevronUp className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )}
                        </div>
                      )}
                    </button>

                    {expandedStep === idx && step.details && (
                      <div className="bg-muted/20 border-t border-border/50 p-3 space-y-1 text-xs">
                        {step.details.map((detail, i) => (
                          <div key={i} className="text-muted-foreground font-mono">
                            {detail}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {testResult && (
            <div className="space-y-4">
              <div className="bg-green-100/50 border border-green-200 rounded-lg p-4">
                <div className="flex items-center gap-3 mb-3">
                  <CheckCircle2 className="w-6 h-6 text-green-600" />
                  <div>
                    <div className="font-semibold text-green-900">Test Execution Successful</div>
                    <p className="text-sm text-green-800">
                      Your pipeline is working correctly and ready for production.
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-muted/30 rounded-lg p-4">
                  <div className="text-sm text-muted-foreground">Records Processed</div>
                  <div className="text-2xl font-bold text-green-600 mt-1">
                    {testResult.recordsProcessed}
                  </div>
                </div>
                <div className="bg-muted/30 rounded-lg p-4">
                  <div className="text-sm text-muted-foreground">Duration</div>
                  <div className="text-2xl font-bold mt-1">{testResult.duration}</div>
                </div>
              </div>

              <div className="flex gap-2">
                <Button onClick={onSuccess} className="flex-1">
                  Proceed to Column Mapping
                </Button>
                <Button onClick={onClose} variant="outline" className="flex-1">
                  Close
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
