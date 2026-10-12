'use client'

import * as React from 'react'
import { Menu as MenuPrimitive } from '@base-ui/react/menu'
import { CheckIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

const Menu = MenuPrimitive.Root
const MenuTrigger = MenuPrimitive.Trigger
const MenuGroup = MenuPrimitive.Group
const MenuRadioGroup = MenuPrimitive.RadioGroup

function MenuContent({ className, align = 'end', sideOffset = 6, children, ...props }: MenuPrimitive.Popup.Props & { align?: 'start' | 'center' | 'end'; sideOffset?: number }) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner align={align} sideOffset={sideOffset} className="z-50 outline-none">
        <MenuPrimitive.Popup
          data-slot="menu"
          className={cn(
            'min-w-56 origin-(--transform-origin) rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground shadow-raised outline-none transition-[opacity,transform] duration-100 data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0',
            className,
          )}
          {...props}
        >
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

const itemClass =
  'flex min-h-8 cursor-default items-center gap-2 rounded-md px-2 py-1.5 outline-none select-none data-[highlighted]:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground'

function MenuItem({ className, ...props }: MenuPrimitive.Item.Props) {
  return <MenuPrimitive.Item className={cn(itemClass, className)} {...props} />
}

function MenuLinkItem({ className, ...props }: MenuPrimitive.LinkItem.Props) {
  return <MenuPrimitive.LinkItem className={cn(itemClass, className)} {...props} />
}

function MenuRadioItem({ className, children, ...props }: MenuPrimitive.RadioItem.Props) {
  return (
    <MenuPrimitive.RadioItem className={cn(itemClass, 'pr-8', className)} {...props}>
      {children}
      <MenuPrimitive.RadioItemIndicator className="ml-auto -mr-6 flex">
        <CheckIcon className="text-live-text!" />
      </MenuPrimitive.RadioItemIndicator>
    </MenuPrimitive.RadioItem>
  )
}

function MenuLabel({ className, ...props }: MenuPrimitive.GroupLabel.Props) {
  return <MenuPrimitive.GroupLabel className={cn('px-2 pt-2 pb-1 font-mono text-[11px] tracking-wide text-muted-foreground uppercase', className)} {...props} />
}

function MenuSeparator({ className }: { className?: string }) {
  return <MenuPrimitive.Separator className={cn('my-1 h-px bg-border', className)} />
}

export { Menu, MenuTrigger, MenuContent, MenuItem, MenuLinkItem, MenuGroup, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator }
