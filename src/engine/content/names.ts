/**
 * Name catalog (owned by the simgen builder).
 *
 * Names are grouped into heritage pools so first/last name pairings are plausible
 * (`generateNpc` picks a pool by `weight`, then a first + last name from that pool).
 * `NAMES` is the flat catalog shape consumed by `ContentCatalog.names`.
 */

export interface NamePool {
  id: string;
  /** free-text heritage labels for `identity.heritage` */
  heritages: string[];
  /** approximate share of the present-day US population */
  weight: number;
  male: string[];
  female: string[];
  last: string[];
}

export const NAME_POOLS: NamePool[] = [
  {
    id: 'anglo',
    heritages: ['Irish-American', 'German-American', 'English-American', 'Scottish-American', 'Scandinavian-American', 'Dutch-American', 'French-American', 'American'],
    weight: 0.44,
    male: [
      'James', 'John', 'Robert', 'Michael', 'William', 'David', 'Richard', 'Joseph', 'Thomas', 'Christopher', 'Daniel', 'Matthew', 'Anthony', 'Mark', 'Donald', 'Steven', 'Paul', 'Andrew', 'Joshua', 'Kenneth',
      'Kevin', 'Brian', 'George', 'Timothy', 'Ronald', 'Jason', 'Edward', 'Jeffrey', 'Ryan', 'Jacob', 'Gary', 'Nicholas', 'Eric', 'Jonathan', 'Stephen', 'Larry', 'Justin', 'Scott', 'Brandon', 'Benjamin',
      'Samuel', 'Gregory', 'Alexander', 'Patrick', 'Frank', 'Raymond', 'Jack', 'Dennis', 'Jerry', 'Tyler', 'Aaron', 'Henry', 'Douglas', 'Peter', 'Adam', 'Nathan', 'Zachary', 'Walter', 'Kyle', 'Harold',
      'Ethan', 'Jeremy', 'Christian', 'Keith', 'Roger', 'Austin', 'Sean', 'Gerald', 'Carl', 'Dylan', 'Jesse', 'Bryan', 'Jordan', 'Bruce', 'Gabriel', 'Logan', 'Wayne', 'Ralph', 'Roy', 'Eugene',
      'Liam', 'Noah', 'Mason', 'Lucas', 'Owen', 'Caleb', 'Wyatt', 'Hunter', 'Connor', 'Cody', 'Cole', 'Chase', 'Tanner', 'Garrett', 'Blake', 'Colton', 'Levi', 'Eli', 'Parker', 'Cooper',
    ],
    female: [
      'Mary', 'Patricia', 'Jennifer', 'Linda', 'Elizabeth', 'Barbara', 'Susan', 'Jessica', 'Sarah', 'Karen', 'Lisa', 'Nancy', 'Betty', 'Sandra', 'Margaret', 'Ashley', 'Kimberly', 'Emily', 'Donna', 'Michelle',
      'Carol', 'Amanda', 'Melissa', 'Deborah', 'Stephanie', 'Rebecca', 'Sharon', 'Laura', 'Cynthia', 'Amy', 'Kathleen', 'Angela', 'Shirley', 'Brenda', 'Emma', 'Anna', 'Pamela', 'Nicole', 'Samantha', 'Katherine',
      'Christine', 'Helen', 'Debra', 'Rachel', 'Carolyn', 'Janet', 'Maria', 'Catherine', 'Heather', 'Diane', 'Olivia', 'Julie', 'Joyce', 'Victoria', 'Ruth', 'Virginia', 'Lauren', 'Kelly', 'Christina', 'Joan',
      'Evelyn', 'Judith', 'Andrea', 'Hannah', 'Megan', 'Cheryl', 'Jacqueline', 'Martha', 'Madison', 'Teresa', 'Abigail', 'Sophia', 'Kathryn', 'Sara', 'Gloria', 'Janice', 'Ava', 'Grace', 'Judy', 'Denise',
      'Chloe', 'Addison', 'Harper', 'Riley', 'Paige', 'Brooke', 'Kaitlyn', 'Mackenzie', 'Sydney', 'Savannah', 'Caroline', 'Claire', 'Lily', 'Ella', 'Natalie', 'Leah', 'Audrey', 'Brianna', 'Kayla', 'Taylor',
    ],
    last: [
      'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Wilson', 'Anderson', 'Taylor', 'Thomas', 'Moore', 'Martin', 'Jackson', 'Thompson', 'White', 'Harris', 'Clark', 'Lewis', 'Walker',
      'Hall', 'Allen', 'Young', 'King', 'Wright', 'Scott', 'Green', 'Baker', 'Adams', 'Nelson', 'Hill', 'Campbell', 'Mitchell', 'Roberts', 'Carter', 'Phillips', 'Evans', 'Turner', 'Parker', 'Collins',
      'Edwards', 'Stewart', 'Morris', 'Murphy', 'Cook', 'Rogers', 'Morgan', 'Peterson', 'Cooper', 'Reed', 'Bailey', 'Bell', 'Kelly', 'Howard', 'Ward', 'Cox', 'Richardson', 'Wood', 'Watson', 'Brooks',
      'Bennett', 'Gray', 'James', 'Hughes', 'Price', 'Myers', 'Long', 'Foster', 'Ross', 'Powell', 'Sullivan', 'Russell', 'Jenkins', 'Perry', 'Butler', 'Barnes', 'Fisher', 'Henderson', 'Marshall', 'Hamilton',
      'Graham', 'Wallace', 'West', 'Cole', 'Hayes', 'Gibson', 'Ellis', 'Ford', 'Mason', 'Stone', 'Hunt', 'Palmer', 'Wells', 'Webb', 'Tucker', 'Porter', 'Hunter', 'Hicks', 'Crawford', 'Boyd',
      'Mueller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer', 'Wagner', 'Becker', 'Hoffman', 'Schultz', 'Zimmerman', 'Klein', 'Braun', 'Keller', 'Lang', 'Schroeder', 'Hansen', 'Larson', 'Olson', 'Lindqvist',
      "O'Brien", "O'Connor", 'Ryan', 'Fitzgerald', 'Gallagher', 'Quinn', 'Doyle', 'Brennan', 'Flynn', 'Duffy', 'Burke', 'Casey', 'MacDonald', 'Fraser', 'Cameron', 'Douglas', 'Kennedy', 'Bryant', 'Griffin', 'Warren',
    ],
  },
  {
    id: 'hispanic',
    heritages: ['Mexican-American', 'Puerto Rican', 'Cuban-American', 'Salvadoran-American', 'Dominican-American', 'Colombian-American', 'Guatemalan-American', 'Honduran-American', 'Tejano', 'Chicano'],
    weight: 0.19,
    male: [
      'José', 'Juan', 'Carlos', 'Luis', 'Miguel', 'Jorge', 'Jesús', 'Francisco', 'Antonio', 'Manuel', 'Pedro', 'Alejandro', 'Ricardo', 'Roberto', 'Fernando', 'Javier', 'Rafael', 'Eduardo', 'Sergio', 'Raúl',
      'Diego', 'Andrés', 'Mateo', 'Santiago', 'Sebastián', 'Emiliano', 'Daniel', 'Adrián', 'Julián', 'Ángel', 'Óscar', 'Héctor', 'Rubén', 'Marco', 'Gustavo', 'Armando', 'Ernesto', 'Guillermo', 'Alberto', 'Arturo',
      'Ramón', 'Salvador', 'Esteban', 'Cristian', 'Iván', 'Enrique', 'Gerardo', 'Rodrigo', 'Joaquín', 'Nicolás', 'Leonardo', 'Israel', 'Ismael', 'Mauricio', 'Felipe', 'Lorenzo', 'Isaac', 'Tomás', 'Hugo', 'Emilio',
    ],
    female: [
      'María', 'Guadalupe', 'Ana', 'Rosa', 'Carmen', 'Juana', 'Elena', 'Patricia', 'Verónica', 'Alejandra', 'Gabriela', 'Adriana', 'Daniela', 'Valeria', 'Sofía', 'Isabella', 'Camila', 'Valentina', 'Ximena', 'Lucía',
      'Mariana', 'Fernanda', 'Andrea', 'Paola', 'Karla', 'Claudia', 'Leticia', 'Silvia', 'Teresa', 'Yolanda', 'Alma', 'Araceli', 'Beatriz', 'Blanca', 'Cecilia', 'Dolores', 'Esperanza', 'Graciela', 'Josefina', 'Lourdes',
      'Marisol', 'Maribel', 'Norma', 'Olga', 'Reyna', 'Rocío', 'Sandra', 'Susana', 'Yesenia', 'Jimena', 'Regina', 'Renata', 'Natalia', 'Catalina', 'Elisa', 'Inés', 'Julieta', 'Luz', 'Mercedes', 'Pilar',
    ],
    last: [
      'García', 'Rodríguez', 'Martínez', 'Hernández', 'López', 'González', 'Pérez', 'Sánchez', 'Ramírez', 'Torres', 'Flores', 'Rivera', 'Gómez', 'Díaz', 'Reyes', 'Cruz', 'Morales', 'Ortiz', 'Gutiérrez', 'Chávez',
      'Ramos', 'Ruiz', 'Álvarez', 'Mendoza', 'Vásquez', 'Castillo', 'Jiménez', 'Moreno', 'Romero', 'Herrera', 'Medina', 'Aguilar', 'Vargas', 'Guzmán', 'Castro', 'Fernández', 'Muñoz', 'Rojas', 'Salazar', 'Delgado',
      'Peña', 'Ríos', 'Contreras', 'Guerrero', 'Sandoval', 'Estrada', 'Ortega', 'Núñez', 'Maldonado', 'Vega', 'Soto', 'Domínguez', 'Espinoza', 'Cabrera', 'Molina', 'Carrillo', 'Luna', 'Navarro', 'Campos', 'Cortez',
      'Padilla', 'Santiago', 'Acosta', 'Figueroa', 'Velázquez', 'Mejía', 'Rosales', 'Fuentes', 'Ochoa', 'Cárdenas', 'Trujillo', 'Zamora', 'Escobar', 'Ibarra', 'Quintero', 'Serrano', 'Valdez', 'Villarreal', 'Barrera', 'Cervantes',
    ],
  },
  {
    id: 'black',
    heritages: ['African-American', 'Black American', 'Afro-Caribbean American', 'Jamaican-American', 'Haitian-American', 'Creole'],
    weight: 0.13,
    male: [
      'Darnell', 'Jamal', 'Terrell', 'Marcus', 'Andre', 'DeShawn', 'Tyrone', 'Malik', 'Jaylen', 'Isaiah', 'Elijah', 'Darius', 'Xavier', 'Terrence', 'Reginald', 'Cedric', 'Lamar', 'Kareem', 'Trevon', 'Jermaine',
      'Damon', 'Maurice', 'Rashad', 'Dominique', 'Jalen', 'Kendrick', 'Quincy', 'Devonte', 'Tavon', 'Antoine', 'Keon', 'Deon', 'Marquis', 'Donte', 'Micah', 'Josiah', 'Zion', 'Amari', 'Kobe', 'Jaden',
      'Cornelius', 'Lamont', 'Dwayne', 'Calvin', 'Curtis', 'Clarence', 'Willie', 'Earl', 'Otis', 'Leroy', 'Alvin', 'Roosevelt', 'Booker', 'Marvin', 'Kwame', 'Ade', 'Malcolm', 'Tremaine', 'Dashawn', 'Andre',
    ],
    female: [
      'Aaliyah', 'Imani', 'Keisha', 'Latoya', 'Tamika', 'Ebony', 'Shanice', 'Jasmine', 'Nia', 'Kiara', 'Destiny', 'Monique', 'Tanisha', 'Aisha', 'Kenya', 'Danielle', 'Tiffany', 'Ayanna', 'Zaria', 'Jada',
      'Ciara', 'Diamond', 'Precious', 'Shaniqua', 'Latasha', 'Shonda', 'Jamila', 'Nakia', 'Simone', 'Camille', 'Brianna', 'Kianna', 'Tierra', 'Alexis', 'Raven', 'Kendra', 'Nadia', 'Amara', 'Zuri', 'Nyla',
      'Bernice', 'Gwendolyn', 'Loretta', 'Odessa', 'Ernestine', 'Bertha', 'Mattie', 'Lula', 'Essie', 'Hattie', 'Deloris', 'Thelma', 'Marlene', 'Rochelle', 'Yvette', 'Sharonda', 'Kimberly', 'Angela', 'Regina', 'Denise',
    ],
    last: [
      'Washington', 'Jefferson', 'Jackson', 'Robinson', 'Coleman', 'Banks', 'Booker', 'Freeman', 'Gaines', 'Mosley', 'Rivers', 'Dorsey', 'Battle', 'Hairston', 'Beasley', 'Broadnax', 'Sims', 'Mack', 'Pruitt', 'Ledbetter',
      'Bryant', 'Simmons', 'Harris', 'Williams', 'Johnson', 'Brown', 'Jones', 'Davis', 'Thomas', 'Green', 'Carter', 'Mitchell', 'Bell', 'Scott', 'Butler', 'Hawkins', 'Gilmore', 'Woods', 'Grant', 'Ford',
      'Toussaint', 'Baptiste', 'Pierre', 'Jean-Louis', 'Charles', 'Lewis', 'Holloway', 'Cummings', 'Dixon', 'Ellison', 'Fields', 'Gaston', 'Hampton', 'Ivory', 'Joseph', 'Lockett', 'McKinney', 'Nash', 'Pettaway', 'Ware',
    ],
  },
  {
    id: 'east_asian',
    heritages: ['Chinese-American', 'Korean-American', 'Vietnamese-American', 'Japanese-American', 'Filipino-American', 'Taiwanese-American', 'Hmong-American', 'Thai-American'],
    weight: 0.06,
    male: [
      'Wei', 'Jun', 'Ming', 'Hao', 'Kai', 'Chen', 'Jian', 'Bo', 'Feng', 'Yong', 'Ji-ho', 'Min-jun', 'Seo-jun', 'Joon', 'Hyun', 'Sung', 'Dong-hyun', 'Ji-hoon', 'Tae', 'Woo-jin',
      'Minh', 'Duc', 'Huy', 'Quang', 'Anh', 'Thanh', 'Tuan', 'Bao', 'Long', 'Phuc', 'Hiroshi', 'Kenji', 'Takeshi', 'Ryo', 'Daichi', 'Yuki', 'Haruto', 'Sora', 'Ren', 'Kaito',
      'Jose Miguel', 'Paolo', 'Rafael', 'Angelo', 'Marco', 'Jericho', 'Dominic', 'Ryan', 'Kevin', 'Eric', 'Jason', 'Andrew', 'Justin', 'Brandon', 'Alan', 'Alvin', 'Winston', 'Vincent', 'Edwin', 'Timothy',
    ],
    female: [
      'Mei', 'Ling', 'Xiu', 'Yan', 'Hua', 'Li', 'Jing', 'Fang', 'Yue', 'Qing', 'Ji-woo', 'Seo-yeon', 'Min-seo', 'Ha-eun', 'Soo-jin', 'Eun-ji', 'Ye-jin', 'Hye-jin', 'Sun-hee', 'Yuna',
      'Linh', 'Thao', 'Trang', 'Huong', 'Mai', 'Ngoc', 'Phuong', 'Lan', 'Hanh', 'Vy', 'Yuki', 'Sakura', 'Aiko', 'Hana', 'Emi', 'Rin', 'Mio', 'Yui', 'Ayumi', 'Naomi',
      'Maria Cristina', 'Angelica', 'Jasmine', 'Kristine', 'Joyce', 'Michelle', 'Grace', 'Vivian', 'Cindy', 'Amy', 'Jenny', 'Tiffany', 'Karen', 'Stephanie', 'Connie', 'Winnie', 'Irene', 'Angela', 'Christine', 'Diana',
    ],
    last: [
      'Wang', 'Li', 'Zhang', 'Liu', 'Chen', 'Yang', 'Huang', 'Zhao', 'Wu', 'Zhou', 'Xu', 'Sun', 'Ma', 'Zhu', 'Hu', 'Guo', 'Lin', 'He', 'Gao', 'Luo',
      'Kim', 'Lee', 'Park', 'Choi', 'Jung', 'Kang', 'Cho', 'Yoon', 'Jang', 'Lim', 'Han', 'Oh', 'Seo', 'Shin', 'Kwon', 'Hwang', 'Ahn', 'Song', 'Yoo', 'Hong',
      'Nguyen', 'Tran', 'Le', 'Pham', 'Hoang', 'Phan', 'Vu', 'Dang', 'Bui', 'Do', 'Ho', 'Ngo', 'Duong', 'Ly', 'Sato', 'Suzuki', 'Takahashi', 'Tanaka', 'Watanabe', 'Ito',
      'Yamamoto', 'Nakamura', 'Kobayashi', 'Kato', 'Santos', 'Reyes', 'Cruz', 'Bautista', 'Dela Cruz', 'Villanueva', 'Mendoza', 'Ramos', 'Aquino', 'Castillo', 'Vang', 'Xiong', 'Thao', 'Yang', 'Chan', 'Wong',
    ],
  },
  {
    id: 'south_asian',
    heritages: ['Indian-American', 'Pakistani-American', 'Bangladeshi-American', 'Sri Lankan-American', 'Nepali-American', 'Punjabi-American', 'Gujarati-American', 'Tamil-American'],
    weight: 0.03,
    male: [
      'Arjun', 'Rohan', 'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Krishna', 'Rahul', 'Raj', 'Sanjay', 'Vikram', 'Amit', 'Anil', 'Ravi', 'Suresh', 'Deepak', 'Nikhil', 'Karan', 'Varun', 'Siddharth',
      'Ali', 'Ahmed', 'Bilal', 'Hamza', 'Imran', 'Faisal', 'Usman', 'Zain', 'Tariq', 'Omar', 'Rafiq', 'Kabir', 'Dev', 'Ishaan', 'Kiran', 'Manish', 'Pranav', 'Rishi', 'Sameer', 'Tarun',
      'Harpreet', 'Gurpreet', 'Jaspreet', 'Manpreet', 'Sandeep', 'Prakash', 'Naveen', 'Ganesh', 'Venkat', 'Srinivas',
    ],
    female: [
      'Priya', 'Ananya', 'Diya', 'Aanya', 'Isha', 'Kavya', 'Riya', 'Neha', 'Pooja', 'Sneha', 'Anjali', 'Divya', 'Shreya', 'Nisha', 'Meera', 'Aditi', 'Sanya', 'Tanvi', 'Ishita', 'Kriti',
      'Ayesha', 'Fatima', 'Zara', 'Sana', 'Hira', 'Mariam', 'Noor', 'Amina', 'Saba', 'Rabia', 'Simran', 'Harleen', 'Jasleen', 'Navdeep', 'Kirandeep', 'Lakshmi', 'Padma', 'Radha', 'Sita', 'Uma',
      'Deepa', 'Geeta', 'Jyoti', 'Rekha', 'Sunita', 'Asha', 'Kamala', 'Malini', 'Nandini', 'Vidya',
    ],
    last: [
      'Patel', 'Shah', 'Sharma', 'Singh', 'Kumar', 'Gupta', 'Mehta', 'Desai', 'Reddy', 'Rao', 'Nair', 'Menon', 'Iyer', 'Pillai', 'Krishnan', 'Raman', 'Subramanian', 'Venkatesh', 'Chandra', 'Verma',
      'Malhotra', 'Kapoor', 'Khanna', 'Chopra', 'Bhatia', 'Sethi', 'Agarwal', 'Jain', 'Joshi', 'Mishra', 'Trivedi', 'Pandey', 'Chaudhry', 'Khan', 'Ahmed', 'Hussain', 'Siddiqui', 'Qureshi', 'Malik', 'Butt',
      'Sheikh', 'Rahman', 'Islam', 'Chowdhury', 'Kaur', 'Gill', 'Dhillon', 'Sandhu', 'Sidhu', 'Grewal', 'Banerjee', 'Chatterjee', 'Mukherjee', 'Das', 'Bose', 'Perera', 'Fernando', 'Thapa', 'Shrestha', 'Bhandari',
    ],
  },
  {
    id: 'middle_eastern',
    heritages: ['Lebanese-American', 'Iranian-American', 'Syrian-American', 'Egyptian-American', 'Iraqi-American', 'Palestinian-American', 'Turkish-American', 'Armenian-American', 'Israeli-American', 'Jordanian-American'],
    weight: 0.02,
    male: [
      'Omar', 'Karim', 'Tariq', 'Sami', 'Nabil', 'Fadi', 'Rami', 'Ziad', 'Hassan', 'Hussein', 'Youssef', 'Ibrahim', 'Khalil', 'Amir', 'Reza', 'Ali', 'Farid', 'Kaveh', 'Navid', 'Arash',
      'Cyrus', 'Darius', 'Babak', 'Mehdi', 'Ramin', 'Mustafa', 'Mehmet', 'Emre', 'Can', 'Kerem', 'Aram', 'Vahan', 'Tigran', 'Sarkis', 'Hovsep', 'Elias', 'George', 'Tony', 'Michel', 'Pierre',
    ],
    female: [
      'Layla', 'Yasmin', 'Nour', 'Dina', 'Rania', 'Hala', 'Lina', 'Maya', 'Nadia', 'Salma', 'Farah', 'Zeinab', 'Amal', 'Rima', 'Ghada', 'Leila', 'Shirin', 'Parisa', 'Niloufar', 'Maryam',
      'Roya', 'Sara', 'Yasmine', 'Azadeh', 'Laleh', 'Elif', 'Zeynep', 'Selin', 'Defne', 'Ayse', 'Ani', 'Lusine', 'Anahit', 'Nairi', 'Talin', 'Mona', 'Christine', 'Joelle', 'Nathalie', 'Carla',
    ],
    last: [
      'Haddad', 'Khoury', 'Nassar', 'Saleh', 'Farah', 'Aziz', 'Rahman', 'Hassan', 'Ahmad', 'Ibrahim', 'Mansour', 'Sayegh', 'Abboud', 'Karam', 'Habib', 'Ghanem', 'Shadid', 'Attieh', 'Maalouf', 'Bishara',
      'Hosseini', 'Ahmadi', 'Tehrani', 'Rahimi', 'Karimi', 'Moradi', 'Jafari', 'Shirazi', 'Farahani', 'Nazari', 'Yilmaz', 'Kaya', 'Demir', 'Sahin', 'Celik', 'Sarkisian', 'Hagopian', 'Petrosyan', 'Kazarian', 'Boghossian',
    ],
  },
  {
    id: 'eastern_european',
    heritages: ['Polish-American', 'Russian-American', 'Ukrainian-American', 'Czech-American', 'Slovak-American', 'Hungarian-American', 'Romanian-American', 'Serbian-American', 'Croatian-American', 'Bosnian-American', 'Lithuanian-American'],
    weight: 0.04,
    male: [
      'Piotr', 'Marek', 'Tomasz', 'Krzysztof', 'Andrzej', 'Jakub', 'Mateusz', 'Kacper', 'Dmitri', 'Sergei', 'Ivan', 'Alexei', 'Nikolai', 'Mikhail', 'Vladimir', 'Yuri', 'Oleg', 'Maksym', 'Bohdan', 'Taras',
      'Andriy', 'Oleksandr', 'Stefan', 'Milan', 'Nikola', 'Luka', 'Marko', 'Dragan', 'Zoran', 'Ivo', 'László', 'Gábor', 'Attila', 'Zoltán', 'Radu', 'Mihai', 'Vlad', 'Adrian', 'Tomas', 'Jonas',
    ],
    female: [
      'Agnieszka', 'Katarzyna', 'Magdalena', 'Zofia', 'Anna', 'Ewa', 'Aleksandra', 'Natalia', 'Olga', 'Svetlana', 'Tatiana', 'Irina', 'Yelena', 'Natasha', 'Anastasia', 'Ekaterina', 'Oksana', 'Yulia', 'Daria', 'Kateryna',
      'Iryna', 'Sofiya', 'Milica', 'Jelena', 'Ivana', 'Ana', 'Dragana', 'Marija', 'Lucija', 'Petra', 'Zsófia', 'Réka', 'Eszter', 'Ioana', 'Andreea', 'Elena', 'Alina', 'Ruta', 'Ieva', 'Egle',
    ],
    last: [
      'Kowalski', 'Nowak', 'Wiśniewski', 'Wójcik', 'Kamiński', 'Lewandowski', 'Zieliński', 'Szymański', 'Dąbrowski', 'Jankowski', 'Ivanov', 'Petrov', 'Sokolov', 'Volkov', 'Kozlov', 'Novikov', 'Morozov', 'Popov', 'Smirnov', 'Kuznetsov',
      'Shevchenko', 'Bondarenko', 'Kovalenko', 'Melnyk', 'Tkachenko', 'Kravchenko', 'Boyko', 'Novak', 'Horvat', 'Kovač', 'Jovanović', 'Petrović', 'Nikolić', 'Marković', 'Babić', 'Nagy', 'Kovács', 'Szabó', 'Tóth', 'Popescu',
      'Ionescu', 'Radu', 'Kazlauskas', 'Petrauskas', 'Dvořák', 'Svoboda', 'Procházka', 'Hodžić', 'Begović', 'Mroz',
    ],
  },
  {
    id: 'southern_european',
    heritages: ['Italian-American', 'Greek-American', 'Portuguese-American', 'Sicilian-American'],
    weight: 0.05,
    male: [
      'Anthony', 'Vincent', 'Salvatore', 'Dominic', 'Angelo', 'Marco', 'Luca', 'Matteo', 'Giovanni', 'Lorenzo', 'Nico', 'Rocco', 'Enzo', 'Carmine', 'Gianni', 'Sal', 'Tony', 'Frankie', 'Joey', 'Dante',
      'Nikos', 'Yiannis', 'Dimitri', 'Kostas', 'Stavros', 'Georgios', 'Alexandros', 'Christos', 'Spiro', 'Theo', 'João', 'Tiago', 'Duarte', 'Rui', 'Nuno', 'Leonardo', 'Sergio', 'Alessandro', 'Fabio', 'Massimo',
    ],
    female: [
      'Gianna', 'Sofia', 'Isabella', 'Giulia', 'Francesca', 'Chiara', 'Alessia', 'Valentina', 'Angela', 'Rosa', 'Teresa', 'Antonietta', 'Lucia', 'Carmela', 'Marie', 'Gina', 'Concetta', 'Filomena', 'Rosalie', 'Bianca',
      'Eleni', 'Maria', 'Katerina', 'Sophia', 'Despina', 'Ioanna', 'Anastasia', 'Christina', 'Georgia', 'Vasiliki', 'Inês', 'Beatriz', 'Mariana', 'Leonor', 'Carolina', 'Matilde', 'Alessandra', 'Elena', 'Serena', 'Marta',
    ],
    last: [
      'Russo', 'Romano', 'Esposito', 'Ricci', 'Marino', 'Greco', 'Bruno', 'Gallo', 'Conti', 'De Luca', 'Costa', 'Giordano', 'Mancini', 'Rizzo', 'Lombardi', 'Moretti', 'Barbieri', 'Fontana', 'Santoro', 'Mariani',
      'Ferrara', 'Caruso', 'DiMaggio', 'Battaglia', 'Gambino', 'Papadopoulos', 'Nikolaou', 'Georgiou', 'Demetriou', 'Konstantinou', 'Pappas', 'Stavros', 'Christodoulou', 'Alexiou', 'Andreou', 'Silva', 'Pereira', 'Sousa', 'Oliveira', 'Carvalho',
    ],
  },
  {
    id: 'african',
    heritages: ['Nigerian-American', 'Ethiopian-American', 'Ghanaian-American', 'Somali-American', 'Kenyan-American', 'Eritrean-American', 'Liberian-American', 'Cameroonian-American'],
    weight: 0.02,
    male: [
      'Chukwuemeka', 'Oluwaseun', 'Adebayo', 'Emeka', 'Chidi', 'Tunde', 'Femi', 'Kwame', 'Kofi', 'Kwabena', 'Yaw', 'Kojo', 'Abebe', 'Dawit', 'Tesfaye', 'Yonas', 'Bereket', 'Samuel', 'Abdi', 'Mohamed',
      'Ahmed', 'Yusuf', 'Hassan', 'Kamau', 'Wanjiru', 'Otieno', 'Mwangi', 'Babatunde', 'Obinna', 'Ikenna', 'Nnamdi', 'Chinedu', 'Uche', 'Ayodele', 'Kwasi', 'Nana', 'Kwaku', 'Fikru', 'Girma', 'Haile',
    ],
    female: [
      'Chioma', 'Ngozi', 'Adaeze', 'Amara', 'Ifeoma', 'Nneka', 'Oluwaseun', 'Folake', 'Yemi', 'Ama', 'Akosua', 'Abena', 'Efua', 'Adwoa', 'Selam', 'Meron', 'Hiwot', 'Tigist', 'Bethlehem', 'Rahel',
      'Hodan', 'Ayaan', 'Fadumo', 'Amina', 'Sahra', 'Wanjiku', 'Akinyi', 'Njeri', 'Chiamaka', 'Ebele', 'Obiageli', 'Temitope', 'Funmilayo', 'Adaora', 'Kemi', 'Afia', 'Esi', 'Yaa', 'Genet', 'Sara',
    ],
    last: [
      'Okafor', 'Okonkwo', 'Adeyemi', 'Adebayo', 'Okoro', 'Eze', 'Nwachukwu', 'Ogunleye', 'Balogun', 'Afolabi', 'Mensah', 'Boateng', 'Owusu', 'Asante', 'Osei', 'Appiah', 'Tesfaye', 'Bekele', 'Haile', 'Gebre',
      'Alemu', 'Kebede', 'Abdullahi', 'Warsame', 'Farah', 'Hussein', 'Kamau', 'Mwangi', 'Odhiambo', 'Wanjiru', 'Diallo', 'Toure', 'Sesay', 'Conteh', 'Ngata', 'Achebe', 'Nwosu', 'Chukwu', 'Ibe', 'Dlamini',
    ],
  },
];

/** Gender-neutral / modern names used for nonbinary sims (also fine as nicknames). */
export const NONBINARY_FIRST_NAMES: string[] = [
  'Sam', 'Alex', 'Jordan', 'Taylor', 'Casey', 'Riley', 'Avery', 'Quinn', 'Morgan', 'Rowan', 'Charlie', 'Jamie', 'Dakota', 'Skyler', 'Emerson', 'Finley', 'Hayden', 'Kai', 'Reese', 'Sage',
  'River', 'Phoenix', 'Ash', 'Blake', 'Cameron', 'Devon', 'Drew', 'Eli', 'Elliot', 'Frankie', 'Harley', 'Indigo', 'Jesse', 'Jules', 'Kit', 'Lane', 'Lennox', 'Marlow', 'Max', 'Micah',
  'Nico', 'Noor', 'Oakley', 'Parker', 'Peyton', 'Remy', 'Robin', 'Rory', 'Sasha', 'Shay', 'Sidney', 'Sky', 'Sol', 'Spencer', 'Sterling', 'Tatum', 'Toby', 'Tristan', 'Val', 'Wren',
  'Zephyr', 'Arden', 'Bay', 'Blair', 'Bryn', 'Cove', 'Ellis', 'Ember', 'Gray', 'Hollis', 'Juniper', 'Lark', 'Linden', 'Onyx', 'Rain', 'Reign', 'Rio', 'Scout', 'Story', 'Winter',
];

function dedupe(list: string[]): string[] {
  return [...new Set(list)];
}

export const NAMES: { first: Record<'male' | 'female' | 'nonbinary', string[]>; last: string[] } = {
  first: {
    male: dedupe(NAME_POOLS.flatMap((p) => p.male)),
    female: dedupe(NAME_POOLS.flatMap((p) => p.female)),
    nonbinary: dedupe(NONBINARY_FIRST_NAMES),
  },
  last: dedupe(NAME_POOLS.flatMap((p) => p.last)),
};

/** Pick a name pool by population weight using a [0,1) roll. */
export function poolForRoll(roll: number): NamePool {
  const total = NAME_POOLS.reduce((s, p) => s + p.weight, 0);
  let r = roll * total;
  for (const p of NAME_POOLS) {
    r -= p.weight;
    if (r <= 0) return p;
  }
  return NAME_POOLS[0];
}

export function poolById(id: string): NamePool | undefined {
  return NAME_POOLS.find((p) => p.id === id);
}

/** Find which pool a last name belongs to (first match), for family-consistent naming. */
export function poolForLastName(lastName: string): NamePool | undefined {
  return NAME_POOLS.find((p) => p.last.includes(lastName));
}
