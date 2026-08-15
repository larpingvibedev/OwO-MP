import { create } from 'zustand';
import type { User, Session } from '@supabase/supabase-js';
import { getSupabase } from '../services/supabase';

export interface UserProfile {
  id: string;
  username: string;
  avatar_url?: string;
}

interface AuthState {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  isLoading: boolean;
  isAuthModalOpen: boolean;
  isConfigModalOpen: boolean;
  isEditProfileOpen: boolean;
  authError: string | null;

  // Actions
  setAuthModalOpen: (open: boolean) => void;
  setConfigModalOpen: (open: boolean) => void;
  setEditProfileOpen: (open: boolean) => void;
  clearError: () => void;
  initAuth: () => Promise<void>;
  signUp: (email: string, pass: string, username: string) => Promise<{ success: boolean; needsEmailConfirmation?: boolean; error?: string }>;
  signIn: (email: string, pass: string) => Promise<{ success: boolean; error?: string }>;
  signOut: () => Promise<void>;
  updateProfile: (username: string, avatarUrl?: string) => Promise<{ success: boolean; error?: string }>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  profile: null,
  isLoading: true,
  isAuthModalOpen: false,
  isConfigModalOpen: false,
  isEditProfileOpen: false,
  authError: null,

  setAuthModalOpen: (open) => set({ isAuthModalOpen: open, authError: null }),
  setConfigModalOpen: (open) => set({ isConfigModalOpen: open }),
  setEditProfileOpen: (open) => set({ isEditProfileOpen: open }),
  clearError: () => set({ authError: null }),

  initAuth: async () => {
    try {
      const supabase = getSupabase();
      const { data: { session }, error } = await supabase.auth.getSession();

      if (error) {
        set({ isLoading: false });
        return;
      }

      if (session?.user) {
        set({ user: session.user, session });
        
        // Fetch profile from database
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .maybeSingle();

        const customUsername = profile?.username || session.user.user_metadata?.username || session.user.email?.split('@')[0] || 'Listener';
        
        set({
          profile: {
            id: session.user.id,
            username: customUsername,
            avatar_url: profile?.avatar_url || ''
          }
        });
      }

      // Listen for auth state changes
      supabase.auth.onAuthStateChange(async (_event, newSession) => {
        if (newSession?.user) {
          set({ user: newSession.user, session: newSession });
          const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', newSession.user.id)
            .maybeSingle();
          
          const customUsername = profile?.username || newSession.user.user_metadata?.username || newSession.user.email?.split('@')[0] || 'Listener';
          set({
            profile: {
              id: newSession.user.id,
              username: customUsername,
              avatar_url: profile?.avatar_url || ''
            }
          });
        } else {
          set({ user: null, session: null, profile: null });
        }
      });
    } catch (err: any) {
      console.warn('Supabase auth init warning:', err?.message);
    } finally {
      set({ isLoading: false });
    }
  },

  signUp: async (email, password, username) => {
    set({ isLoading: true, authError: null });
    try {
      const supabase = getSupabase();
      const chosenUsername = username.trim() || email.split('@')[0];

      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            username: chosenUsername
          }
        }
      });

      if (error) {
        set({ authError: error.message, isLoading: false });
        return { success: false, error: error.message };
      }

      // If user was created
      if (data.user) {
        // Explicitly write username to profiles table
        try {
          await supabase.from('profiles').upsert({
            id: data.user.id,
            username: chosenUsername,
            updated_at: new Date().toISOString()
          });
        } catch (e) {}

        set({
          user: data.user,
          session: data.session,
          profile: {
            id: data.user.id,
            username: chosenUsername
          }
        });
      }

      // Check if email verification is required (session is null when email confirmation is enabled)
      const needsConfirmation = data.user && !data.session;

      set({ isLoading: false });
      return { success: true, needsEmailConfirmation: Boolean(needsConfirmation) };
    } catch (err: any) {
      const msg = err?.message || 'Sign up failed';
      set({ authError: msg, isLoading: false });
      return { success: false, error: msg };
    }
  },

  signIn: async (email, password) => {
    set({ isLoading: true, authError: null });
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password
      });

      if (error) {
        let msg = error.message;
        if (msg.toLowerCase().includes('email not confirmed')) {
          msg = 'Please check your email inbox and click the verification link before signing in.';
        }
        set({ authError: msg, isLoading: false });
        return { success: false, error: msg };
      }

      if (data.user) {
        set({ user: data.user, session: data.session });

        // Retrieve profile
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', data.user.id)
          .maybeSingle();

        const customUsername = profile?.username || data.user.user_metadata?.username || data.user.email?.split('@')[0] || 'Listener';
        set({
          profile: {
            id: data.user.id,
            username: customUsername,
            avatar_url: profile?.avatar_url || ''
          }
        });
      }

      set({ isLoading: false, isAuthModalOpen: false });
      return { success: true };
    } catch (err: any) {
      const msg = err?.message || 'Sign in failed';
      set({ authError: msg, isLoading: false });
      return { success: false, error: msg };
    }
  },

  signOut: async () => {
    try {
      const supabase = getSupabase();
      await supabase.auth.signOut();
    } catch (e) {}
    set({ user: null, session: null, profile: null });
  },

  updateProfile: async (username, avatarUrl) => {
    const user = get().user;
    if (!user) return { success: false, error: 'Not logged in' };
    try {
      const supabase = getSupabase();
      const cleanName = username.trim() || 'Listener';

      // 1. Update database table
      const { error: dbError } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          username: cleanName,
          avatar_url: avatarUrl || '',
          updated_at: new Date().toISOString()
        });

      if (dbError) throw dbError;

      // 2. Update auth user metadata
      await supabase.auth.updateUser({
        data: { username: cleanName }
      });

      // 3. Update local state
      set({
        profile: {
          id: user.id,
          username: cleanName,
          avatar_url: avatarUrl || ''
        }
      });

      return { success: true };
    } catch (err: any) {
      console.warn('Profile update failed:', err?.message);
      return { success: false, error: err?.message || 'Update failed' };
    }
  }
}));
