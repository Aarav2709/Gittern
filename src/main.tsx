import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { Shell } from './components/Shell';
import { ConfirmHost, Empty, Loading, Toasts } from './components/ui';
import { queryClient } from './lib/api';
import { AuthProvider } from './lib/auth';
import { Commit, Commits } from './pages/Commits';
import { Home } from './pages/Home';
import { GlobalIssues, IssueDetail, IssueList, NewIssue } from './pages/Issues';
import { Actions, ActionsStorage, RunDetail } from './pages/Actions';
import { DiscussionDetail, Discussions, NewDiscussion } from './pages/Discussions';
import { Desktop } from './pages/Desktop';
import { Explore } from './pages/Explore';
import { GistDetail, GistForm, Gists } from './pages/Gists';
import { Branches, Login, Notifications, ReleaseByTag, ReleaseForm, Releases, RepoSearch, Search, Tags } from './pages/Misc';
import { Deployments, Insights, Labels, MilestoneDetail, Milestones, People, ProjectDetail, Projects, Security } from './pages/RepoMore';
import { Settings } from './pages/Settings';
import { FileEditor, NewPull, NewRepo, RepoSettings } from './pages/Manage';
import { Profile } from './pages/Profile';
import { OwnerProjectPage } from './pages/Project';
import { Wiki } from './pages/Wiki';
import { UploadFiles } from './pages/Upload';
import { Blob } from './pages/Blob';
import { Code, RepoLayout } from './pages/Repo';
import { activeTabPath } from './lib/store';
import './styles.css';

// reopen on whatever the active tab was showing last time
if (!location.hash) location.hash = activeTabPath();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider
        loading={<Loading label="Connecting to GitHub…" />}
        fallback={(api, error) => <Login api={api} error={error} />}
      >
        <HashRouter>
          <Routes>
            <Route element={<Shell />}>
              <Route index element={<Home />} />
              <Route path="notifications" element={<Notifications />} />
              <Route path="search" element={<Search />} />
              <Route path="new" element={<NewRepo />} />
              <Route path="pulls" element={<GlobalIssues kind="pr" />} />
              <Route path="issues" element={<GlobalIssues kind="issue" />} />
              <Route path="explore" element={<Explore />} />
              <Route path="local" element={<Desktop />} />
              <Route path="settings" element={<Settings />} />
              <Route path="gists" element={<Gists />} />
              <Route path="gists/new" element={<GistForm />} />
              <Route path="gist/:id" element={<GistDetail />} />
              <Route path="gist/:id/edit" element={<GistForm />} />
              <Route path="project/:owner/:number" element={<OwnerProjectPage />} />
              <Route path=":owner" element={<Profile />} />
              <Route path=":owner/:repo" element={<RepoLayout />}>
                <Route index element={<Code />} />
                <Route path="tree/*" element={<Code />} />
                <Route path="blob/*" element={<Blob />} />
                <Route path="edit/*" element={<FileEditor />} />
                <Route path="new/*" element={<FileEditor create />} />
                <Route path="upload/*" element={<UploadFiles />} />
                <Route path="compare" element={<NewPull />} />
                <Route path="compare/*" element={<NewPull />} />
                <Route path="search" element={<RepoSearch />} />
                <Route path="discussions" element={<Discussions />} />
                <Route path="discussions/new" element={<NewDiscussion />} />
                <Route path="discussions/:number" element={<DiscussionDetail />} />
                <Route path="labels" element={<Labels />} />
                <Route path="milestones" element={<Milestones />} />
                <Route path="milestone/:number" element={<MilestoneDetail />} />
                <Route path="stargazers" element={<People kind="stargazers" />} />
                <Route path="watchers" element={<People kind="subscribers" />} />
                <Route path="forks" element={<People kind="forks" />} />
                <Route path="insights" element={<Insights />} />
                <Route path="security" element={<Security />} />
                <Route path="projects" element={<Projects />} />
                <Route path="projects/:number" element={<ProjectDetail />} />
                <Route path="deployments" element={<Deployments />} />
                <Route path="tags" element={<Tags />} />
                <Route path="wiki" element={<Wiki />} />
                <Route path="releases/new" element={<ReleaseForm />} />
                <Route path="releases/edit/:id" element={<ReleaseForm />} />
                <Route path="releases/tag/*" element={<ReleaseByTag />} />
                <Route path="actions/artifacts" element={<ActionsStorage />} />
                <Route path="settings" element={<RepoSettings />} />
                <Route path="issues" element={<IssueList kind="issue" />} />
                <Route path="pulls" element={<IssueList kind="pr" />} />
                <Route path="issues/new" element={<NewIssue />} />
                <Route path="issues/:number" element={<IssueDetail />} />
                <Route path="pull/:number" element={<IssueDetail />} />
                <Route path="pull/:number/files" element={<IssueDetail view="files" />} />
                <Route path="pull/:number/commits" element={<IssueDetail view="commits" />} />
                <Route path="pull/:number/checks" element={<IssueDetail view="checks" />} />
                <Route path="blame/*" element={<Blob blame />} />
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
      <Toasts />
      <ConfirmHost />
    </QueryClientProvider>
  </StrictMode>,
);
