"use client";
import React, { useState } from "react";
import Link from "next/link";
import {
  Home,
  Code,
  GitPullRequest,
  FileText,
  Users,
  Settings,
  Search,
  Bell,
  Plus,
  GitBranch,
  Star,
  Eye,
  GitFork,
  Clock,
  TrendingUp,
  Menu,
  X,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

const GitHubDashboard = () => {
  const [activeTab, setActiveTab] = useState("overview");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const sidebarItems = [
    { icon: Home, label: "Overview", id: "overview" },
    { icon: Code, label: "Repositories", id: "repos" },
    { icon: GitPullRequest, label: "Pull Requests", id: "prs" },
    { icon: FileText, label: "Issues", id: "issues" },
    { icon: Users, label: "Teams", id: "teams" },
    { icon: Settings, label: "Settings", id: "settings" },
  ];

  const repositories = [
    {
      name: "awesome-project",
      visibility: "Public",
      language: "TypeScript",
      stars: 142,
      forks: 23,
      updated: "2 hours ago",
    },
    {
      name: "api-gateway",
      visibility: "Private",
      language: "Go",
      stars: 89,
      forks: 12,
      updated: "5 hours ago",
    },
    {
      name: "mobile-app",
      visibility: "Public",
      language: "React Native",
      stars: 256,
      forks: 45,
      updated: "1 day ago",
    },
    {
      name: "ml-pipeline",
      visibility: "Private",
      language: "Python",
      stars: 34,
      forks: 8,
      updated: "3 days ago",
    },
  ];

  const recentActivity = [
    {
      type: "commit",
      repo: "awesome-project",
      message: "feat: add authentication module",
      time: "1 hour ago",
    },
    {
      type: "pr",
      repo: "api-gateway",
      message: "Update dependencies and fix tests",
      time: "3 hours ago",
    },
    {
      type: "issue",
      repo: "mobile-app",
      message: "Bug: Login screen crashes on iOS",
      time: "5 hours ago",
    },
    {
      type: "star",
      repo: "ml-pipeline",
      message: "Starred repository",
      time: "1 day ago",
    },
  ];

  // Sidebar content component to reuse in both desktop and mobile
  const SidebarContent = ({ onItemClick }) => (
    <>
      {/* Logo */}
      <div className="p-4 md:p-6 border-b border-[#30363d]">
        <Link href="/dashboard" className="flex items-center gap-3">
          <div className="w-8 h-8 bg-yellow-500 rounded-md flex items-center justify-center font-bold text-black text-lg">
            G
          </div>
          <span className="text-lg font-semibold">Dashboard</span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 md:p-4 space-y-1">
        {sidebarItems.map((item) => (
          <Link
            key={item.id}
            href={`/${item.id}`}
            onClick={() => {
              setActiveTab(item.id);
              onItemClick?.();
            }}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === item.id
                ? "bg-yellow-500 text-black"
                : "text-gray-300 hover:bg-[#1f2937] hover:text-white"
            }`}
          >
            <item.icon className="w-5 h-5" />
            {item.label}
          </Link>
        ))}
      </nav>

      {/* User Profile */}
      <div className="p-4 border-t border-[#30363d]">
        <Link
          href="/profile"
          className="flex items-center gap-3 hover:bg-[#1f2937] p-2 rounded-md transition-colors"
        >
          <Avatar className="w-10 h-10">
            <AvatarImage src="https://github.com/shadcn.png" />
            <AvatarFallback className="bg-yellow-500 text-black">
              JD
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">John Doe</p>
            <p className="text-xs text-gray-400 truncate">@johndoe</p>
          </div>
        </Link>
      </div>
    </>
  );

  return (
    <div className="flex h-screen bg-[#0d1117] text-gray-100">
      {/* Desktop Sidebar - Hidden on mobile */}
      <aside className="hidden lg:flex w-64 bg-[#161b22] border-r border-[#30363d] flex-col">
        <SidebarContent />
      </aside>

      {/* Mobile Sidebar - Sheet component */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent
          side="left"
          className="w-64 p-0 bg-[#161b22] border-[#30363d]"
        >
          <SidebarContent onItemClick={() => setMobileMenuOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto w-full">
        {/* Header */}
        <header className="bg-[#161b22] border-b border-[#30363d] sticky top-0 z-10">
          <div className="px-4 md:px-6 lg:px-8 py-3 md:py-4 flex items-center justify-between gap-3">
            {/* Mobile Menu Button */}
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden text-gray-300 hover:text-white hover:bg-[#1f2937]"
              onClick={() => setMobileMenuOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </Button>

            {/* Search Bar */}
            <div className="flex-1 max-w-xl">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Search..."
                  className="pl-10 bg-[#0d1117] border-[#30363d] text-gray-100 placeholder:text-gray-500 focus:border-yellow-500 focus:ring-yellow-500 text-sm"
                />
              </div>
            </div>

            {/* Header Actions */}
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="text-gray-300 hover:text-white hover:bg-[#1f2937]"
              >
                <Bell className="w-5 h-5" />
              </Button>
              <Button className="bg-yellow-500 text-black hover:bg-yellow-600 font-medium hidden sm:flex">
                <Plus className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">New</span>
              </Button>
              <Button
                size="icon"
                className="bg-yellow-500 text-black hover:bg-yellow-600 font-medium sm:hidden"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="p-4 md:p-6 lg:p-8">
          {/* Stats Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 lg:gap-6 mb-6 md:mb-8">
            <Card className="bg-[#161b22] border-[#30363d]">
              <CardHeader className="pb-2 md:pb-3">
                <CardTitle className="text-xs md:text-sm font-medium text-gray-400">
                  Repositories
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-2xl md:text-3xl font-bold text-white">
                      24
                    </p>
                    <p className="text-xs text-gray-500 mt-1">+3 this month</p>
                  </div>
                  <Code className="w-6 h-6 md:w-8 md:h-8 text-yellow-500" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-[#161b22] border-[#30363d]">
              <CardHeader className="pb-2 md:pb-3">
                <CardTitle className="text-xs md:text-sm font-medium text-gray-400">
                  Pull Requests
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-2xl md:text-3xl font-bold text-white">
                      12
                    </p>
                    <p className="text-xs text-gray-500 mt-1">5 open</p>
                  </div>
                  <GitPullRequest className="w-6 h-6 md:w-8 md:h-8 text-yellow-500" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-[#161b22] border-[#30363d]">
              <CardHeader className="pb-2 md:pb-3">
                <CardTitle className="text-xs md:text-sm font-medium text-gray-400">
                  Total Stars
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-2xl md:text-3xl font-bold text-white">
                      521
                    </p>
                    <p className="text-xs text-gray-500 mt-1">+42 this week</p>
                  </div>
                  <Star className="w-6 h-6 md:w-8 md:h-8 text-yellow-500" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-[#161b22] border-[#30363d]">
              <CardHeader className="pb-2 md:pb-3">
                <CardTitle className="text-xs md:text-sm font-medium text-gray-400">
                  Contributors
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-2xl md:text-3xl font-bold text-white">
                      38
                    </p>
                    <p className="text-xs text-gray-500 mt-1">Across all</p>
                  </div>
                  <Users className="w-6 h-6 md:w-8 md:h-8 text-yellow-500" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
            {/* Repositories List */}
            <div className="lg:col-span-2">
              <Card className="bg-[#161b22] border-[#30363d]">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base md:text-lg">
                      Recent Repositories
                    </CardTitle>
                    <Link
                      href="/repositories"
                      className="text-yellow-500 hover:text-yellow-400 hover:bg-[#1f2937] text-xs md:text-sm px-3 py-1.5 rounded-md transition-colors"
                    >
                      View all
                    </Link>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 md:space-y-4">
                  {repositories.map((repo, index) => (
                    <div
                      key={index}
                      className="pb-3 md:pb-4 border-b border-[#30363d] last:border-0 last:pb-0"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <Code className="w-4 h-4 md:w-5 md:h-5 text-gray-400 flex-shrink-0" />
                          <Link
                            href={`/repos/${repo.name}`}
                            className="font-semibold text-sm md:text-base text-white hover:text-yellow-500 cursor-pointer transition-colors truncate"
                          >
                            {repo.name}
                          </Link>
                          <Badge
                            variant="outline"
                            className={`text-xs flex-shrink-0 ${
                              repo.visibility === "Public"
                                ? "border-green-500/50 text-green-400"
                                : "border-gray-600 text-gray-400"
                            }`}
                          >
                            {repo.visibility}
                          </Badge>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-gray-400 hover:text-white hover:bg-[#1f2937] flex-shrink-0"
                        >
                          <Star className="w-3.5 h-3.5 md:w-4 md:h-4" />
                        </Button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 md:gap-4 text-xs md:text-sm text-gray-400 ml-0 md:ml-7">
                        <span className="flex items-center gap-1">
                          <span className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full bg-blue-500"></span>
                          <span className="hidden sm:inline">
                            {repo.language}
                          </span>
                          <span className="sm:hidden">
                            {repo.language.substring(0, 3)}
                          </span>
                        </span>
                        <span className="flex items-center gap-1">
                          <Star className="w-3 h-3 md:w-3.5 md:h-3.5" />
                          {repo.stars}
                        </span>
                        <span className="flex items-center gap-1">
                          <GitFork className="w-3 h-3 md:w-3.5 md:h-3.5" />
                          {repo.forks}
                        </span>
                        <span className="flex items-center gap-1 ml-auto">
                          <Clock className="w-3 h-3 md:w-3.5 md:h-3.5" />
                          <span className="hidden sm:inline">
                            {repo.updated}
                          </span>
                          <span className="sm:hidden">
                            {repo.updated.split(" ")[0]}
                            {repo.updated.includes("hour")
                              ? "h"
                              : repo.updated.includes("day")
                              ? "d"
                              : ""}
                          </span>
                        </span>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            {/* Sidebar Content - Activity & Trending */}
            <div className="space-y-4 md:space-y-6">
              {/* Recent Activity */}
              <Card className="bg-[#161b22] border-[#30363d]">
                <CardHeader>
                  <CardTitle className="text-base md:text-lg">
                    Recent Activity
                  </CardTitle>
                  <CardDescription className="text-gray-400 text-xs md:text-sm">
                    Your latest actions
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 md:space-y-4">
                  {recentActivity.map((activity, index) => (
                    <div key={index} className="flex gap-2 md:gap-3">
                      <div
                        className={`w-7 h-7 md:w-8 md:h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                          activity.type === "commit"
                            ? "bg-green-500/10"
                            : activity.type === "pr"
                            ? "bg-blue-500/10"
                            : activity.type === "issue"
                            ? "bg-red-500/10"
                            : "bg-yellow-500/10"
                        }`}
                      >
                        {activity.type === "commit" && (
                          <GitBranch className="w-3.5 h-3.5 md:w-4 md:h-4 text-green-400" />
                        )}
                        {activity.type === "pr" && (
                          <GitPullRequest className="w-3.5 h-3.5 md:w-4 md:h-4 text-blue-400" />
                        )}
                        {activity.type === "issue" && (
                          <FileText className="w-3.5 h-3.5 md:w-4 md:h-4 text-red-400" />
                        )}
                        {activity.type === "star" && (
                          <Star className="w-3.5 h-3.5 md:w-4 md:h-4 text-yellow-400" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs md:text-sm font-medium text-gray-300 truncate">
                          {activity.message}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {activity.repo}
                        </p>
                        <p className="text-xs text-gray-600 mt-0.5">
                          {activity.time}
                        </p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Trending Repositories */}
              <Card className="bg-[#161b22] border-[#30363d]">
                <CardHeader>
                  <CardTitle className="text-base md:text-lg flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 md:w-5 md:h-5 text-yellow-500" />
                    Trending Today
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    {
                      name: "vercel/next.js",
                      stars: "127k",
                      url: "/repos/vercel/next.js",
                    },
                    {
                      name: "microsoft/vscode",
                      stars: "162k",
                      url: "/repos/microsoft/vscode",
                    },
                    {
                      name: "facebook/react",
                      stars: "228k",
                      url: "/repos/facebook/react",
                    },
                  ].map((repo, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between"
                    >
                      <div className="min-w-0 flex-1">
                        <Link
                          href={repo.url}
                          className="text-xs md:text-sm font-medium text-white hover:text-yellow-500 cursor-pointer transition-colors truncate block"
                        >
                          {repo.name}
                        </Link>
                        <p className="text-xs text-gray-500">Open source</p>
                      </div>
                      <div className="flex items-center gap-1 text-xs md:text-sm text-gray-400 flex-shrink-0 ml-2">
                        <Star className="w-3 h-3 md:w-3.5 md:h-3.5 fill-yellow-500 text-yellow-500" />
                        {repo.stars}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default GitHubDashboard;
