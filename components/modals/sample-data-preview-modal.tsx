'use client'

import { useState } from 'react'
import { X, Download, Copy, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

interface SampleDataPreviewModalProps {
  isOpen: boolean
  sourceName: string
  sourceType: string
  onClose: () => void
  onProceed: () => void
}

export default function SampleDataPreviewModal({
  isOpen,
  sourceName,
  sourceType,
  onClose,
  onProceed,
}: SampleDataPreviewModalProps) {
  const [copied, setCopied] = useState(false)

  // Mock sample data based on source type
  const getSampleData = () => {
    const samples: Record<string, { columns: string[]; rows: Record<string, any>[] }> = {
      sap: {
        columns: ['Document_ID', 'Customer_Code', 'Amount', 'Currency', 'Document_Date', 'Status'],
        rows: [
          {
            Document_ID: '10001234',
            Customer_Code: 'CUST001',
            Amount: 15750.50,
            Currency: 'USD',
            Document_Date: '2024-01-15',
            Status: 'Posted',
          },
          {
            Document_ID: '10001235',
            Customer_Code: 'CUST002',
            Amount: 8920.25,
            Currency: 'USD',
            Document_Date: '2024-01-16',
            Status: 'Posted',
          },
          {
            Document_ID: '10001236',
            Customer_Code: 'CUST003',
            Amount: 22100.00,
            Currency: 'EUR',
            Document_Date: '2024-01-17',
            Status: 'Pending',
          },
        ],
      },
      oracle: {
        columns: ['ORDER_ID', 'CUSTOMER_NAME', 'ORDER_DATE', 'TOTAL_AMOUNT', 'STATUS'],
        rows: [
          {
            ORDER_ID: 'ORD-2024-001',
            CUSTOMER_NAME: 'Acme Corporation',
            ORDER_DATE: '2024-01-10',
            TOTAL_AMOUNT: 45000.00,
            STATUS: 'COMPLETED',
          },
          {
            ORDER_ID: 'ORD-2024-002',
            CUSTOMER_NAME: 'Tech Solutions Inc',
            ORDER_DATE: '2024-01-11',
            TOTAL_AMOUNT: 32500.50,
            STATUS: 'IN_PROGRESS',
          },
          {
            ORDER_ID: 'ORD-2024-003',
            CUSTOMER_NAME: 'Global Enterprises',
            ORDER_DATE: '2024-01-12',
            TOTAL_AMOUNT: 58200.00,
            STATUS: 'COMPLETED',
          },
        ],
      },
      mysql: {
        columns: ['user_id', 'email', 'first_name', 'last_name', 'created_at', 'active'],
        rows: [
          {
            user_id: 1,
            email: 'john.doe@example.com',
            first_name: 'John',
            last_name: 'Doe',
            created_at: '2023-12-01',
            active: true,
          },
          {
            user_id: 2,
            email: 'jane.smith@example.com',
            first_name: 'Jane',
            last_name: 'Smith',
            created_at: '2023-12-05',
            active: true,
          },
          {
            user_id: 3,
            email: 'bob.wilson@example.com',
            first_name: 'Bob',
            last_name: 'Wilson',
            created_at: '2023-12-10',
            active: false,
          },
        ],
      },
      postgresql: {
        columns: ['id', 'product_name', 'category', 'price', 'stock_quantity', 'last_updated'],
        rows: [
          {
            id: 101,
            product_name: 'Laptop Pro',
            category: 'Electronics',
            price: 1299.99,
            stock_quantity: 45,
            last_updated: '2024-01-18',
          },
          {
            id: 102,
            product_name: 'Wireless Mouse',
            category: 'Accessories',
            price: 29.99,
            stock_quantity: 156,
            last_updated: '2024-01-17',
          },
          {
            id: 103,
            product_name: 'USB-C Cable',
            category: 'Accessories',
            price: 12.99,
            stock_quantity: 342,
            last_updated: '2024-01-16',
          },
        ],
      },
      rest: {
        columns: ['id', 'title', 'description', 'priority', 'assigned_to', 'created_date'],
        rows: [
          {
            id: 'TASK-001',
            title: 'Implement API endpoint',
            description: 'Create REST endpoint for user management',
            priority: 'High',
            assigned_to: 'Alice Johnson',
            created_date: '2024-01-15',
          },
          {
            id: 'TASK-002',
            title: 'Update documentation',
            description: 'Update API documentation with examples',
            priority: 'Medium',
            assigned_to: 'Bob Smith',
            created_date: '2024-01-16',
          },
          {
            id: 'TASK-003',
            title: 'Performance optimization',
            description: 'Optimize database queries',
            priority: 'High',
            assigned_to: 'Alice Johnson',
            created_date: '2024-01-17',
          },
        ],
      },
      csv: {
        columns: ['Name', 'Email', 'Department', 'Salary', 'Start_Date'],
        rows: [
          {
            Name: 'Alice Johnson',
            Email: 'alice@company.com',
            Department: 'Engineering',
            Salary: 95000,
            Start_Date: '2020-03-15',
          },
          {
            Name: 'Bob Smith',
            Email: 'bob@company.com',
            Department: 'Sales',
            Salary: 75000,
            Start_Date: '2021-06-01',
          },
          {
            Name: 'Carol Davis',
            Email: 'carol@company.com',
            Department: 'Marketing',
            Salary: 82000,
            Start_Date: '2019-09-10',
          },
        ],
      },
    }
    return samples[sourceType.toLowerCase()] || samples.rest
  }

  const sampleData = getSampleData()
  const jsonPreview = JSON.stringify(sampleData.rows, null, 2)

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonPreview)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-lg border border-border max-w-4xl w-full max-h-[90vh] overflow-auto">
        <div className="sticky top-0 bg-card border-b border-border p-6 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Sample Data Preview</h3>
            <p className="text-sm text-muted-foreground mt-1">{sourceName}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="p-6 space-y-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold">Table Preview ({sampleData.rows.length} sample records)</h4>
              <Badge className="bg-blue-100 text-blue-800">{sourceType.toUpperCase()}</Badge>
            </div>

            <div className="overflow-x-auto border border-border/50 rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/30 border-b border-border/50">
                    {sampleData.columns.map((col) => (
                      <th key={col} className="px-4 py-2 text-left font-medium">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sampleData.rows.map((row, idx) => (
                    <tr key={idx} className="border-b border-border/50 hover:bg-muted/20">
                      {sampleData.columns.map((col) => (
                        <td key={`${idx}-${col}`} className="px-4 py-2">
                          <span className="text-muted-foreground">
                            {String(row[col])}
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold">JSON Response Format</h4>
              <Button size="sm" variant="outline" onClick={handleCopy}>
                <Copy className="w-4 h-4 mr-1" />
                {copied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
            <div className="bg-muted/30 rounded-lg p-4 overflow-x-auto max-h-64 overflow-y-auto">
              <pre className="text-xs text-muted-foreground font-mono">{jsonPreview}</pre>
            </div>
          </div>

          <div className="bg-blue-100/50 border border-blue-200 rounded-lg p-4">
            <div className="flex gap-2">
              <CheckCircle2 className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <div className="font-semibold text-blue-900">Data Source Connected</div>
                <p className="text-blue-800 mt-1">
                  You can now proceed to build your pipeline. This sample data will be used for testing transformations and column mappings.
                </p>
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={onProceed} className="flex-1">
              Proceed to Pipeline Design
            </Button>
            <Button onClick={onClose} variant="outline" className="flex-1">
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
