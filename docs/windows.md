# Windows manual guide

[中文](windows.zh.md) · [Project home](../README.md)

Only tested on the author's current Windows machine and the OpenCode Desktop version in use. This is not an official SAP plugin.

## Install

1. On GitHub, choose **Code → Download ZIP** and extract it. An existing clone works too.
2. Open the repository's **plugins** folder. It contains three independent plugin folders; pick the ones you want.
3. In File Explorer, enter `C:\Users\<your user>\.config\opencode` in the address bar. Replace `<your user>` with your user folder name, for example `C:\Users\alex\.config\opencode`, then press Enter. This is a folder address, not a command; do not enter `~` here.
4. If there is no **plugins** folder, copy the repository's **plugins** folder here. If one exists, open it and copy only the selected plugin folders inside. Do not copy the whole repository or replace other plugins.
5. In **Settings → Extensions → Plugins**, check the switches. For the theme, select **Fiori Horizon Light** in **Settings → Appearance → Theme** and use light mode.

No build, terminal commands, Node installation, or config editing is needed. `test.cjs` can stay in the plugin folders; it does not run during normal use.

> If Windows asks to replace files, cancel and check the existing installation first. Update older explicit-config installations at their original location; do not install a second copy.

If a plugin reports a load failure, try its **Reload** button. If the list is stale, save your work and reopen the desktop window. A custom config location needs its own setup; never copy someone else's whole configuration folder.

The internal names **fiori-horizon-light** and **desktop-workflow** are kept for compatibility.

## Use

- **Theme:** Fiori Horizon changes the conversation colors and the document viewer's Markdown style, using a light look closer to SAP Fiori.
- **Search:** in the existing right-side file filter, try `report md`. It finds `.md` files whose name or path contains `report`; add `docs` to narrow the path.
- **Locate:** with UX enabled, opening a file expands its parents and selects and scrolls to its tree node. Enable Navigation and UX together for both search and file-tree follow.
- **Read:** the existing Review toggle or **Ctrl+Shift+R** switches the right panel between hidden and full width, replacing its normal split-view toggle. Full width hides the conversation; it is not Windows full screen.
- **Open files:** click an underlined path in a reply or its final file list, or focus it and press Enter, to open it on the right. The file must exist; the plugin does not create the list.
- **Edit:** try a disposable local text copy first. Click **Edit**, then **Save** or **Ctrl+S**. **Discard changes** drops the draft. Save before closing the window.
- **Follow the work:** tool groups open while running and show command and action summaries. They close after a later reply or execution ends; reopen them for the original details.
- **File actions:** the toolbar offers copy, download, file manager, and editor choices.

## Update or remove

Save edits first and switch off the affected plugin. To update, move its old folder **outside** the plugins directory as a backup, then copy the new folder into its place. Do not merge old and new files.

To remove, move the plugin folder out of `C:\Users\<your user>\.config\opencode\plugins`. Do not put it in another subfolder there. For Fiori, choose your previous theme first.

## If something goes wrong

Check the folder nesting, plugin switch, and OpenCode version. A rejected save may mean unsupported size/encoding, missing permissions, or an external edit. Copy your draft somewhere safe before closing.

Report the version, steps, and actual result. Remove private content and paths from screenshots. When sharing the project, keep the licenses and third-party notices.

[Project home](../README.md)
