
        class F1DataManager {
            constructor() {
                this.baseUrl = 'https://api.openf1.org/v1';
                this.currentYear = new Date().getFullYear();
                this.cache = new Map();
                this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
            }

            async fetchWithCache(url, cacheKey) {
                const cached = this.cache.get(cacheKey);
                if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
                    return cached.data;
                }

                try {
                    const response = await fetch(url);
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    const data = await response.json();
                    this.cache.set(cacheKey, { data, timestamp: Date.now() });
                    return data;
                } catch (error) {
                    console.error(`Error fetching ${cacheKey}:`, error);
                    return cached ? cached.data : [];
                }
            }

            async getCurrentSession() {
                const sessions = await this.fetchWithCache(
                    `${this.baseUrl}/sessions?year=${this.currentYear}&session_name=Race`,
                    'current-sessions'
                );
                return sessions.length > 0 ? sessions[sessions.length - 1] : null;
            }

            async getRaceResults(sessionKey) {
                const results = await this.fetchWithCache(
                    `${this.baseUrl}/results?session_key=${sessionKey}`,
                    `race-results-${sessionKey}`
                );
                return results.sort((a, b) => a.position - b.position);
            }

            async getDrivers() {
                return await this.fetchWithCache(
                    `${this.baseUrl}/drivers?year=${this.currentYear}`,
                    'current-drivers'
                );
            }

            async getAllResults() {
                const sessions = await this.fetchWithCache(
                    `${this.baseUrl}/sessions?year=${this.currentYear}&session_name=Race`,
                    'all-sessions'
                );
                
                const allResults = [];
                for (const session of sessions) {
                    const results = await this.fetchWithCache(
                        `${this.baseUrl}/results?session_key=${session.session_key}`,
                        `results-${session.session_key}`
                    );
                    allResults.push(...results);
                }
                return allResults;
            }

            calculateDriverStandings(allResults, drivers) {
                const pointsSystem = {1: 25, 2: 18, 3: 15, 4: 12, 5: 10, 6: 8, 7: 6, 8: 4, 9: 2, 10: 1};
                const standings = new Map();

                allResults.forEach(result => {
                    if (!result.position || result.position > 10) return;
                    
                    const driverKey = result.driver_number;
                    if (!standings.has(driverKey)) {
                        const driver = drivers.find(d => d.driver_number === driverKey);
                        standings.set(driverKey, {
                            driver_number: driverKey,
                            full_name: driver ? `${driver.first_name} ${driver.last_name}` : 'Unknown',
                            team_name: driver ? driver.team_name : 'Unknown',
                            points: 0,
                            wins: 0
                        });
                    }
                    
                    const points = pointsSystem[result.position] || 0;
                    standings.get(driverKey).points += points;
                    if (result.position === 1) {
                        standings.get(driverKey).wins += 1;
                    }
                });

                return Array.from(standings.values())
                    .sort((a, b) => b.points - a.points)
                    .map((driver, index) => ({ ...driver, position: index + 1 }));
            }

            calculateConstructorStandings(driverStandings) {
                const constructors = new Map();

                driverStandings.forEach(driver => {
                    if (!constructors.has(driver.team_name)) {
                        constructors.set(driver.team_name, {
                            team_name: driver.team_name,
                            points: 0,
                            wins: 0
                        });
                    }
                    constructors.get(driver.team_name).points += driver.points;
                    constructors.get(driver.team_name).wins += driver.wins;
                });

                return Array.from(constructors.values())
                    .sort((a, b) => b.points - a.points)
                    .map((constructor, index) => ({ ...constructor, position: index + 1 }));
            }

            getTeamColor(teamName) {
                const colors = {
                    'Red Bull Racing': '#1E41FF',
                    'Mercedes': '#00D2BE',
                    'Ferrari': '#DC0000',
                    'McLaren': '#FF8700',
                    'Aston Martin': '#006F62',
                    'Alpine': '#0090FF',
                    'Williams': '#005AFF',
                    'AlphaTauri': '#2B4562',
                    'Alfa Romeo': '#900000',
                    'Haas': '#FFFFFF'
                };
                return colors[teamName] || '#666666';
            }

            formatTime(milliseconds) {
                if (!milliseconds) return 'N/A';
                const totalSeconds = milliseconds / 1000;
                const minutes = Math.floor(totalSeconds / 60);
                const seconds = (totalSeconds % 60).toFixed(3);
                return minutes > 0 ? `${minutes}:${seconds.padStart(6, '0')}` : `${seconds}s`;
            }

            getPointsForPosition(position) {
                const pointsSystem = {1: 25, 2: 18, 3: 15, 4: 12, 5: 10, 6: 8, 7: 6, 8: 4, 9: 2, 10: 1};
                return pointsSystem[position] || 0;
            }
        }

        class F1UI {
            constructor(dataManager) {
                this.dataManager = dataManager;
            }

            showLoading(sectionId) {
                document.getElementById(`${sectionId}Loading`).classList.remove('hidden');
                document.getElementById(`${sectionId}Content`).classList.add('hidden');
            }

            hideLoading(sectionId) {
                document.getElementById(`${sectionId}Loading`).classList.add('hidden');
                document.getElementById(`${sectionId}Content`).classList.remove('hidden');
            }

            async renderCurrentRace() {
                this.showLoading('currentRace');

                try {
                    const currentSession = await this.dataManager.getCurrentSession();
                    if (!currentSession) {
                        document.getElementById('currentRaceContent').innerHTML = 
                            '<div class="no-data">No current race data available</div>';
                        this.hideLoading('currentRace');
                        return;
                    }

                    const results = await this.dataManager.getRaceResults(currentSession.session_key);
                    
                    document.getElementById('raceTitle').textContent = 
                        `${currentSession.location} Grand Prix`;
                    document.getElementById('raceDate').textContent = 
                        new Date(currentSession.date_start).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                        });

                    const tableBody = document.getElementById('raceResultsTable');
                    tableBody.innerHTML = results.slice(0, 20).map(result => `
                        <tr>
                            <td class="position">${result.position || 'DNF'}</td>
                            <td class="driver-name">${result.full_name || 'Unknown'}</td>
                            <td>
                                <span class="team-badge" style="background-color: ${this.dataManager.getTeamColor(result.team_name)}">
                                    ${result.team_name || 'Unknown'}
                                </span>
                            </td>
                            <td class="time">${this.dataManager.formatTime(result.time)}</td>
                            <td class="points">${this.dataManager.getPointsForPosition(result.position)}</td>
                        </tr>
                    `).join('');

                } catch (error) {
                    console.error('Error rendering current race:', error);
                    document.getElementById('currentRaceContent').innerHTML = 
                        '<div class="error-message">Error loading race results</div>';
                }

                this.hideLoading('currentRace');
            }

            async renderDriverStandings() {
                this.showLoading('drivers');

                try {
                    const [allResults, drivers] = await Promise.all([
                        this.dataManager.getAllResults(),
                        this.dataManager.getDrivers()
                    ]);

                    const standings = this.dataManager.calculateDriverStandings(allResults, drivers);

                    const tableBody = document.getElementById('driversTable');
                    tableBody.innerHTML = standings.map(driver => `
                        <tr>
                            <td class="position">${driver.position}</td>
                            <td class="driver-name">${driver.full_name}</td>
                            <td>
                                <span class="team-badge" style="background-color: ${this.dataManager.getTeamColor(driver.team_name)}">
                                    ${driver.team_name}
                                </span>
                            </td>
                            <td class="points">${driver.points}</td>
                            <td class="wins">${driver.wins}</td>
                        </tr>
                    `).join('');

                } catch (error) {
                    console.error('Error rendering driver standings:', error);
                    document.getElementById('driversContent').innerHTML = 
                        '<div class="error-message">Error loading driver standings</div>';
                }

                this.hideLoading('drivers');
            }

            async renderConstructorStandings() {
                this.showLoading('constructors');

                try {
                    const [allResults, drivers] = await Promise.all([
                        this.dataManager.getAllResults(),
                        this.dataManager.getDrivers()
                    ]);

                    const driverStandings = this.dataManager.calculateDriverStandings(allResults, drivers);
                    const constructorStandings = this.dataManager.calculateConstructorStandings(driverStandings);

                    const tableBody = document.getElementById('constructorsTable');
                    tableBody.innerHTML = constructorStandings.map(constructor => `
                        <tr>
                            <td class="position">${constructor.position}</td>
                            <td>
                                <div class="constructor-name">
                                    <div class="team-color" style="background-color: ${this.dataManager.getTeamColor(constructor.team_name)}"></div>
                                    <span class="driver-name">${constructor.team_name}</span>
                                </div>
                            </td>
                            <td class="points">${constructor.points}</td>
                            <td class="wins">${constructor.wins}</td>
                        </tr>
                    `).join('');

                } catch (error) {
                    console.error('Error rendering constructor standings:', error);
                    document.getElementById('constructorsContent').innerHTML = 
                        '<div class="error-message">Error loading constructor standings</div>';
                }

                this.hideLoading('constructors');
            }

            updateLastUpdated() {
                document.getElementById('lastUpdated').textContent = 
                    `Last updated: ${new Date().toLocaleTimeString()}`;
            }

            async initializeApp() {
                this.updateLastUpdated();

                
                await Promise.all([
                    this.renderCurrentRace(),
                    this.renderDriverStandings(),
                    this.renderConstructorStandings()
                ]);

                
                setInterval(() => {
                    this.renderCurrentRace();
                    this.renderDriverStandings();
                    this.renderConstructorStandings();
                    this.updateLastUpdated();
                }, 5 * 60 * 1000);
            }
        }

    
        document.addEventListener('DOMContentLoaded', () => {
            const dataManager = new F1DataManager();
            const ui = new F1UI(dataManager);
            ui.initializeApp();
        });
