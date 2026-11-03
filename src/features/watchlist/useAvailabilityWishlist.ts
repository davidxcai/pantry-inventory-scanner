import {useEffect} from 'react'
import {useQuery,useMutation,useQueryClient} from '@tanstack/react-query'
import type {CatalogRow} from '../../../shared/catalogView'
import {loadAvailabilityWishlist,setAvailabilityWishlist} from './availabilityWishlistData'
const key=(userId:string|undefined)=>['availability-wishlist',userId]
export function useAvailabilityWishlist(userId:string|undefined){
  const client=useQueryClient()
  const query=useQuery({queryKey:key(userId),enabled:!!userId,queryFn:()=>loadAvailabilityWishlist(userId!),staleTime:10_000,refetchInterval:30_000})
  useEffect(()=>{
    if(!userId)return
    const refresh=()=>void client.invalidateQueries({queryKey:key(userId)})
    window.addEventListener('storage',refresh);window.addEventListener('online',refresh)
    return()=>{window.removeEventListener('storage',refresh);window.removeEventListener('online',refresh)}
  },[client,userId])
  const mutation=useMutation({mutationKey:['availability-wishlist-change',userId],
    mutationFn:({item,enabled}:{item:CatalogRow;enabled:boolean})=>setAvailabilityWishlist(userId??'',item,enabled,true),
    onSuccess:()=>Promise.all([client.invalidateQueries({queryKey:key(userId)}),client.invalidateQueries({queryKey:['personal-watchlist',userId]})]),
  })
  return {query,mutation}
}
