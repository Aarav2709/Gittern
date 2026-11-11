import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { Shell } from './components/Shell';
import { Empty, Loading } from './components/ui';
import { queryClient } from './lib/api';
import { AuthProvider } from './lib/auth';
import { Commit, Commits } from './pages/Commits';
import { Home } from './pages/Home';
import { GlobalIssues, IssueDetail, IssueList, NewIssue } from './pages/Issues';
import { Actions, Branches, Login, Notifications, Releases, RunDetail, Search } from './pages/Misc';
import { Profile } from './pages/Profile';
import { Blob, Code, RepoLayout } from './pages/Repo';
import { activeTabPath } from './lib/store';
import './styles.css';

// Reopen on whatever the active tab was showing last time.
if (!location.hash) location.hash = activeTabPath();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider
        loading={<Loading label="Connecting to GitHub…" />}
        fallback={(signIn, error) => <Login signIn={signIn} error={error} />}
      >
        <HashRouter>
          <Routes>
            <Route element={<Shell />}>
              <Route index element={<Home />} />
              <Route path="notifications" element={<Notifications />} />
              <Route path="search" element={<Search />} />
              <Route path="pulls" element={<GlobalIssues kind="pr" />} />
              <Route path="issues" element={<GlobalIssues kind="issue" />} />
              <Route path=":owner" element={<Profile />} />
              <Route path=":owner/:repo" element={<RepoLayout />}>
                <Route index element={<Code />} />
                <Route path="tree/*" element={<Code />} />
                <Route path="blob/*" element={<Blob />} />
                <Route path="issues" element={<IssueList kind="issue" />} />
                <Route path="pulls" element={<IssueList kind="pr" />} />
                <Route path="issues/new" element={<NewIssue />} />
                <Route path="issues/:number" element={<IssueDetail />} />
                <Route path="pull/:number" element={<IssueDetail />} />
                <Route path="pull/:number/files" element={<IssueDetail files />} />
                <Route path="commits/*" element={<Commits />} />
                <Route path="commit/:sha" element={<Commit />} />
                <Route path="actions" element={<Actions />} />
                <Route path="actions/runs/:runId" element={<RunDetail />} />
                <Route path="branches" element={<Branches />} />
                <Route path="releases" element={<Releases />} />
                <Route path="*" element={<Empty title="Not in Gittern yet">This repository page isn't built yet.</Empty>} />
              </Route>
              <Route path="*" element={<Empty title="Page not found" />} />
            </Route>
          </Routes>
        </HashRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
