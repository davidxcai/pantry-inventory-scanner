import { createFileRoute,redirect } from '@tanstack/react-router'
export const Route=createFileRoute('/_auth/watching')({beforeLoad:()=>{throw redirect({to:'/profile',search:{list:'wishlist'}})}})
