import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase } from '../../lib/supabase'
const settings = z.object({enabled:z.boolean()})
const key = (userId: string | undefined) => ['wishlist-email-settings',userId]
export function useWishlistEmails(userId: string | undefined) {
  const client = useQueryClient()
  const query = useQuery({
    queryKey:key(userId),enabled:!!userId,
    queryFn:async () => {
      const {data,error}=await supabase.rpc('get_wishlist_email_settings')
      if(error) {
        if(['PGRST202','42883'].includes(error.code)) return {ready:false,enabled:false}
        throw new Error('Could not load your email preferences. Please retry.')
      }
      return {ready:true,...settings.parse(data)}
    },retry:false,refetchOnWindowFocus:true,
  })
  const mutation=useMutation({
    mutationFn:async (enabled:boolean) => {
      const {error}=await supabase.rpc('set_wishlist_email_enabled',{p_enabled:enabled})
      if(error) throw new Error('Could not update email alerts. Please retry.')
    },
    onSuccess:()=>client.invalidateQueries({queryKey:key(userId)}),
  })
  return {query,mutation}
}
