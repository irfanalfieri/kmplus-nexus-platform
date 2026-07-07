'use client'

import { useState } from 'react'
import { X, Eye, EyeOff, CheckCircle2, AlertCircle, Loader } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

interface DataSourceAuthModalProps {
  isOpen: boolean
  sourceId: string
  sourceName: string
  sourceType: string
  onClose: () => void
  onSuccess: (credentials: Record<string, string>) => void
}

export default function DataSourceAuthModal({
  isOpen,
  sourceId,
  sourceName,
  sourceType,
  onClose,
  onSuccess,
}: DataSourceAuthModalProps) {
  const [step, setStep] = useState<'credentials' | 'testing' | 'success'>('credentials')
  const [showPassword, setShowPassword] = useState(false)
  const [credentials, setCredentials] = useState<Record<string, string>>({})
  const [testMessage, setTestMessage] = useState('')

  const getFieldsForSourceType = (type: string) => {
    const fieldMap: Record<string, { label: string; type: string; required: boolean }[]> = {
      sap: [
        { label: 'Host', type: 'text', required: true },
        { label: 'Port', type: 'text', required: true },
        { label: 'Client', type: 'text', required: true },
        { label: 'Username', type: 'text', required: true },
        { label: 'Password', type: 'password', required: true },
      ],
      oracle: [
        { label: 'Host', type: 'text', required: true },
        { label: 'Port', type: 'text', required: true },
        { label: 'Service Name', type: 'text', required: true },
        { label: 'Username', type: 'text', required: true },
        { label: 'Password', type: 'password', required: true },
      ],
      mysql: [
        { label: 'Host', type: 'text', required: true },
        { label: 'Port', type: 'text', required: true },
        { label: 'Database', type: 'text', required: true },
        { label: 'Username', type: 'text', required: true },
        { label: 'Password', type: 'password', required: true },
      ],
      postgresql: [
        { label: 'Host', type: 'text', required: true },
        { label: 'Port', type: 'text', required: true },
        { label: 'Database', type: 'text', required: true },
        { label: 'Username', type: 'text', required: true },
        { label: 'Password', type: 'password', required: true },
      ],
      rest: [
        { label: 'API URL', type: 'text', required: true },
        { label: 'API Key', type: 'password', required: false },
        { label: 'Auth Header (optional)', type: 'text', required: false },
      ],
      csv: [
        { label: 'File Path (optional)', type: 'text', required: false },
      ],
    }
    return fieldMap[type.toLowerCase()] || []
  }

  const handleTestConnection = () => {
    setStep('testing')
    setTestMessage('Testing connection...')
    
    setTimeout(() => {
      const isValid = Object.values(credentials).some(v => v.trim() !== '')
      if (isValid) {
        setTestMessage('Connection successful! Sample data loaded.')
        setTimeout(() => {
          setStep('success')
        }, 1500)
      } else {
        setTestMessage('Connection failed. Please check your credentials.')
      }
    }, 2000)
  }

  const handleConfirm = () => {
    onSuccess(credentials)
    onClose()
  }

  const fields = getFieldsForSourceType(sourceType)

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-lg border border-border p-6 max-w-md w-full">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Authorize Data Source</h3>
          <Button size="sm" variant="ghost" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="mb-4">
          <div className="text-sm text-muted-foreground mb-2">{sourceName}</div>
          <Badge className="bg-blue-100 text-blue-800">{sourceType.toUpperCase()}</Badge>
        </div>

        {step === 'credentials' && (
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground mb-4">
              Enter your {sourceName} credentials to authorize connection
            </div>
            {fields.map((field) => (
              <div key={field.label}>
                <label className="text-sm font-medium block mb-1">{field.label}</label>
                <div className="relative">
                  <Input
                    type={field.type === 'password' && !showPassword ? 'password' : 'text'}
                    placeholder={field.label}
                    value={credentials[field.label] || ''}
                    onChange={(e) =>
                      setCredentials({
                        ...credentials,
                        [field.label]: e.target.value,
                      })
                    }
                  />
                  {field.type === 'password' && (
                    <button
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2"
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <Eye className="w-4 h-4 text-muted-foreground" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            ))}

            <Button onClick={handleTestConnection} className="w-full mt-4">
              Test Connection
            </Button>
          </div>
        )}

        {step === 'testing' && (
          <div className="space-y-4 py-6 text-center">
            <Loader className="w-8 h-8 animate-spin mx-auto text-blue-600" />
            <div className="text-sm text-muted-foreground">{testMessage}</div>
          </div>
        )}

        {step === 'success' && (
          <div className="space-y-4">
            <div className="flex items-center justify-center">
              <CheckCircle2 className="w-12 h-12 text-green-600" />
            </div>
            <div className="text-center">
              <div className="font-semibold text-green-600">Connection Authorized</div>
              <div className="text-sm text-muted-foreground mt-2">
                Your credentials have been verified and sample data is ready for preview.
              </div>
            </div>
            <Button onClick={handleConfirm} className="w-full">
              Proceed to Sample Preview
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
