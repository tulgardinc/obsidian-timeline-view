# Obsidian Sample Plugin

This is a sample plugin for Obsidian (https://obsidian.md).

This project uses TypeScript to provide type checking and documentation.
The repo depends on the latest plugin API (obsidian.d.ts) in TypeScript Definition format, which contains TSDoc comments describing what it does.

This sample plugin demonstrates some of the basic functionality the plugin API can do.
- Adds a ribbon icon, which shows a Notice when clicked.
- Adds a command "Open modal (simple)" which opens a Modal.
- Adds a plugin setting tab to the settings page.
- Registers a global click event and output 'click' to the console.
- Registers a global interval which logs 'setInterval' to the console.

## First time developing plugins?

Quick starting guide for new plugin devs:

- Check if [someone already developed a plugin for what you want](https://obsidian.md/plugins)! There might be an existing plugin similar enough that you can partner up with.
- Make a copy of this repo as a template with the "Use this template" button (login to GitHub if you don't see it).
- Clone your repo to a local development folder. For convenience, you can place this folder in your `.obsidian/plugins/your-plugin-name` folder.
- Install NodeJS, then run `npm i` in the command line under your repo folder.
- Run `npm run dev` to compile your plugin from `main.ts` to `main.js`.
- Make changes to `main.ts` (or create new `.ts` files). Those changes should be automatically compiled into `main.js`.
- Reload Obsidian to load the new version of your plugin.
- Enable plugin in settings window.
- For updates to the Obsidian API run `npm update` in the command line under your repo folder.

## Releasing new releases

- Update your `manifest.json` with your new version number, such as `1.0.1`, and the minimum Obsidian version required for your latest release.
- Update your `versions.json` file with `"new-plugin-version": "minimum-obsidian-version"` so older versions of Obsidian can download an older version of your plugin that's compatible.
- Create new GitHub release using your new version number as the "Tag version". Use the exact version number, don't include a prefix `v`. See here for an example: https://github.com/obsidianmd/obsidian-sample-plugin/releases
- Upload the files `manifest.json`, `main.js`, `styles.css` as binary attachments. Note: The manifest.json file must be in two places, first the root path of your repository and also in the release.
- Publish the release.

> You can simplify the version bump process by running `npm version patch`, `npm version minor` or `npm version major` after updating `minAppVersion` manually in `manifest.json`.
> The command will bump version in `manifest.json` and `package.json`, and add the entry for the new version to `versions.json`

## Adding your plugin to the community plugin list

- Check the [plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines).
- Publish an initial version.
- Make sure you have a `README.md` file in the root of your repo.
- Make a pull request at https://github.com/obsidianmd/obsidian-releases to add your plugin.

## How to use

- Clone this repo.
- Make sure your NodeJS is at least v16 (`node --version`).
- `npm i` or `yarn` to install dependencies.
- `npm run dev` to start compilation in watch mode.

## Manually installing the plugin

- Copy over `main.js`, `styles.css`, `manifest.json` to your vault `VaultFolder/.obsidian/plugins/your-plugin-id/`.

## Improve code quality with eslint
- [ESLint](https://eslint.org/) is a tool that analyzes your code to quickly find problems. You can run ESLint against your plugin to find common bugs and ways to improve your code. 
- This project already has eslint preconfigured, you can invoke a check by running`npm run lint`
- Together with a custom eslint [plugin](https://github.com/obsidianmd/eslint-plugin) for Obsidan specific code guidelines.
- A GitHub action is preconfigured to automatically lint every commit on all branches.

## Funding URL

You can include funding URLs where people who use your plugin can financially support it.

The simple way is to set the `fundingUrl` field to your link in your `manifest.json` file:

```json
{
    "fundingUrl": "https://buymeacoffee.com"
}
```

If you have multiple URLs, you can also do:

```json
{
    "fundingUrl": {
        "Buy Me a Coffee": "https://buymeacoffee.com",
        "GitHub Sponsor": "https://github.com/sponsors",
        "Patreon": "https://www.patreon.com/"
    }
}
```

## API Documentation

See https://docs.obsidian.md

---

# Timeline Plugin Date Format

## Supported Date Ranges

The timeline plugin now supports **arbitrary date ranges** from **10 billion years BCE to 10 billion years CE** (and beyond).

Unlike JavaScript's native Date object (limited to ±273,000 years), this plugin uses:
- **Julian Day Number algorithms** for astronomical precision
- **BigInt-safe day counts** for arbitrary year ranges
- **Custom date arithmetic** without floating-point precision issues

## Date Formats

### Standard Format (current to ±10,000 years)
```yaml
date-start: 2024-03-15
date-end: 2024-06-20
```

### Extended Format with Era Suffix (any year range)
```yaml
# With explicit era
date-start: 5000000000 BCE-01-01
date-end: 4000000000 BCE-12-31

# Or use negative years (astronomical notation)
date-start: -5000000000-01-01
date-end: -4000000000-12-31

# Far future
date-start: 10000-01-01
date-end: 10000-12-31
```

### Supported Era Suffixes
- `BCE` / `BC` - Before Common Era (astronomical year 0 = 1 BCE)
- `CE` / `AD` - Common Era (default, optional)

## Year Numbering Systems

### Historical Notation (displayed)
- **1 BCE** → year 0 in calculations
- **1 CE** → year 1 in calculations
- No year 0 in historical notation

### Astronomical Notation (internal)
- **Year 0** exists (1 BCE in historical terms)
- **Negative years** are BCE (year -1 = 2 BCE)
- Used for all internal calculations

## Example Frontmatter

```yaml
---
timeline: true
date-start: 4500000000-06-15
date-end: 4400000000-12-01
color: red
---

# Formation of the Earth

This event occurred approximately 4.5 billion years ago.
```

## Scale-Based Display

The timeline automatically adjusts date display based on zoom level:

| Scale Level | Display Format | Example |
|-------------|---------------|---------|
| Days | DD/MM/YYYY | 15/03/2024 |
| Weeks | DD/MM/YYYY | 15/03/2024 |
| Months | MM/YYYY | 03/2024 |
| Years | YYYY CE/BCE | 2024 CE |
| Decades | 10-year notation | 2020s |
| Centuries | century notation | 21st century |
| Millennia | k-years | 3k BCE |
| Millions | M-years | 4.5M BCE |
| Billions | B-years | 4.5B BCE |

## Technical Details

- **Epoch**: 1970-01-01 (Unix epoch)
- **Coordinate system**: Days from epoch as Numbers
- **Max safe range**: ±20 billion years (3.65 trillion days)
- **Marker generation**: Julian Day Number algorithm for all dates
- **No floating-point precision issues** at extreme scales
