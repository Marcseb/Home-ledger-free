import { Redirect } from 'expo-router';
import React from 'react';
import { Spinner } from '@/components/Ui';
import { useLedger } from '@/lib/ledger-context';
export default function Index() { const { session, loading } = useLedger(); if (loading) return <Spinner />; return <Redirect href={session ? '/(tabs)' : '/pair'} />; }