import { createFileRoute,redirect } from '@tanstack/react-router'
export const Route=createFileRoute('/_auth/wishlist')({beforeLoad:()=>{throw redirect({to:'/profile',search:{list:'wishlist'}})}})
