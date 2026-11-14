/** Every course in the game, in the order the course picker shows them. */
import { type CourseDef, type CourseJson, parseCourse } from '../game/hole';
import lantern from './courses/lantern-park.json';
import loon from './courses/loon-lake.json';
import mesa from './courses/red-mesa.json';

export const COURSES: CourseDef[] = [lantern, loon, mesa].map((j) => parseCourse(j as unknown as CourseJson));

/** Look a course up by id (falls back to the first course for unknown ids). */
export const courseById = (id: string | undefined): CourseDef => COURSES.find((c) => c.id === id) ?? COURSES[0];

/** One line about each course for the picker. */
export const COURSE_BLURB: Record<string, string> = {
  'lantern-park': 'THE HOME COURSE · CREEKS AND OLD OAKS',
  'loon-lake': 'NORTHWOODS · PINES AND A LOT OF WATER',
  'red-mesa': 'DESERT CANYON · WIND, WASHES AND BIG DROPS',
};
